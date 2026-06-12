import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExercisesService } from '../exercises/exercises.service.js';
import { RoutinesService } from '../routines/routines.service.js';
import { WorkoutsService } from '../workouts/workouts.service.js';
import {
  CreateRoutineDto,
  UpdateRoutineDto,
} from '../routines/dto/routine.dto.js';
import { ListExercisesDto } from '../exercises/dto/list-exercises.dto.js';
import { MCP_SERVER_INSTRUCTIONS, MCP_TOOLS } from './mcp-tools.js';

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export interface McpCaller {
  userId: string;
  scopes: string[];
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
}

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

async function toDto<T extends object>(
  cls: new () => T,
  data: unknown,
): Promise<T> {
  const instance = plainToInstance(cls, data ?? {});
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });
  if (errors.length > 0) {
    const details = errors
      .map((e) => Object.values(e.constraints ?? {}).join('; '))
      .filter(Boolean)
      .join('; ');
    throw new BadRequestException(details || 'Invalid arguments');
  }
  return instance;
}

/**
 * Stateless MCP server (streamable HTTP, single JSON response per POST).
 * Exposes the connector REST surface (§6–7) as MCP tools (§9).
 */
@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly exercises: ExercisesService,
    private readonly routines: RoutinesService,
    private readonly workouts: WorkoutsService,
  ) {}

  /** Returns null for notifications (no response body → HTTP 202). */
  async handleMessage(
    message: JsonRpcRequest,
    caller: McpCaller,
  ): Promise<JsonRpcResponse | null> {
    if (!message || typeof message !== 'object' || !message.method) {
      return this.error(message?.id ?? null, -32600, 'Invalid request');
    }

    const isNotification = message.id === undefined || message.id === null;

    try {
      switch (message.method) {
        case 'initialize':
          return this.result(message.id!, this.initialize(message.params));
        case 'ping':
          return this.result(message.id!, {});
        case 'tools/list':
          return this.result(message.id!, {
            tools: MCP_TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          });
        case 'tools/call':
          return this.result(
            message.id!,
            await this.callTool(message.params, caller),
          );
        default:
          if (isNotification) return null; // notifications/* are fire-and-forget
          return this.error(
            message.id!,
            -32601,
            `Method not found: ${message.method}`,
          );
      }
    } catch (err) {
      if (isNotification) return null;
      const text =
        err instanceof HttpException
          ? JSON.stringify(err.getResponse())
          : 'Internal error';
      if (!(err instanceof HttpException)) {
        this.logger.error(`MCP ${message.method} failed`, err);
      }
      return this.error(message.id!, -32603, text);
    }
  }

  private initialize(params: any) {
    const requested = params?.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : SUPPORTED_PROTOCOL_VERSIONS[1];
    return {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'wolog-connector', version: '1.0.0' },
      instructions: MCP_SERVER_INSTRUCTIONS,
    };
  }

  private async callTool(params: any, caller: McpCaller) {
    const name = params?.name as string;
    const args = params?.arguments ?? {};

    const tool = MCP_TOOLS.find((t) => t.name === name);
    if (!tool) {
      return this.toolError(`Unknown tool: ${name}`);
    }
    if (tool.scope && !caller.scopes.includes(tool.scope)) {
      return this.toolError(
        `This connection is missing the "${tool.scope}" permission. The user must reconnect and grant it.`,
      );
    }

    try {
      const result = await this.dispatch(name, args, caller.userId);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      if (err instanceof HttpException) {
        const body = err.getResponse();
        return this.toolError(
          typeof body === 'string' ? body : JSON.stringify(body, null, 2),
        );
      }
      this.logger.error(`MCP tool ${name} failed`, err);
      return this.toolError('Internal error executing tool');
    }
  }

  private async dispatch(name: string, args: any, userId: string) {
    switch (name) {
      case 'list_exercises': {
        const dto = await toDto(ListExercisesDto, {
          query: args.query,
          limit: args.limit ?? 50,
          offset: args.offset ?? 0,
        });
        return this.exercises.list(dto, userId);
      }
      case 'list_routines':
        return this.routines.list(userId);
      case 'get_routine': {
        if (typeof args.id !== 'string') {
          throw new BadRequestException('id is required');
        }
        return this.routines.getOne(userId, args.id);
      }
      case 'create_routine': {
        const dto = await toDto(CreateRoutineDto, args.routine);
        return this.routines.create(userId, dto);
      }
      case 'update_routine': {
        if (typeof args.id !== 'string') {
          throw new BadRequestException('id is required');
        }
        const dto = await toDto(UpdateRoutineDto, {
          ...args.routine,
          baseUpdatedAt: args.baseUpdatedAt ?? args.routine?.baseUpdatedAt,
        });
        return this.routines.update(userId, args.id, dto);
      }
      case 'get_workout_history': {
        if (args.exerciseId) {
          return this.workouts.exerciseHistory(
            userId,
            args.exerciseId,
            Math.min(Math.max(Number(args.limit) || 10, 1), 50),
          );
        }
        return this.workouts.listWorkouts(userId, {
          since: args.since,
          limit: Math.min(Math.max(Number(args.limit) || 20, 1), 100),
        });
      }
      default:
        throw new BadRequestException(`Unknown tool: ${name}`);
    }
  }

  private toolError(text: string) {
    return { content: [{ type: 'text', text }], isError: true };
  }

  private result(id: string | number, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private error(
    id: string | number | null,
    code: number,
    message: string,
  ): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }
}
