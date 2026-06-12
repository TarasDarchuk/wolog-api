import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { ConnectorAuthGuard } from '../common/guards/connector-auth.guard.js';
import type { ConnectorRequest } from '../common/guards/connector-auth.guard.js';
import { ALL_SCOPES } from '../oauth/scopes.js';
import { McpService } from './mcp.service.js';

/**
 * Remote MCP endpoint (streamable HTTP, stateless: one JSON-RPC message per
 * POST, no SSE stream). Lives at /mcp (outside the /api/v1 prefix).
 * Unauthenticated requests get a 401 with a WWW-Authenticate header pointing
 * at the protected-resource metadata, which is how MCP clients discover the
 * OAuth flow.
 */
@Public()
@UseGuards(ConnectorAuthGuard)
@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Post()
  async handle(
    @Body() body: unknown,
    @Req() req: ConnectorRequest,
    @Res() res: Response,
  ) {
    const caller = {
      userId: req.user!.id,
      scopes: req.authScopes ?? [...ALL_SCOPES],
    };

    // The 2025 MCP revisions dropped JSON-RPC batching; reject arrays.
    if (Array.isArray(body)) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Batch requests are not supported' },
      });
      return;
    }

    const response = await this.mcp.handleMessage(body as never, caller);
    if (!response) {
      res.status(202).send();
      return;
    }
    res.status(200).json(response);
  }

  // Stateless server: no SSE stream to resume, no session to delete.
  @Get()
  @HttpCode(405)
  get() {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'SSE streaming is not supported' },
    };
  }

  @Delete()
  @HttpCode(405)
  delete() {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'Sessions are not supported' },
    };
  }
}
