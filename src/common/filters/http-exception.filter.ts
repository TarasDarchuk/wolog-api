import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { safeBodyForLog } from '../utils/redact.js';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const status: number = exception.getStatus();
    const body = exception.getResponse();

    if (status >= 400 && status < 500 && !isUnknownRoute(status, body)) {
      // An expired access token is routine (the app refreshes and retries),
      // so don't dump the user's workout payload into the logs for it.
      const bodyPart =
        status === (HttpStatus.UNAUTHORIZED as number)
          ? ''
          : `Body: ${safeBodyForLog(request.body)} | `;
      this.logger.warn(
        `${status} ${request.method} ${request.url} | ${bodyPart}` +
          `Error: ${JSON.stringify(body)}`,
      );
    }

    response.status(status).json(body);
  }
}

/** Express router 404 ("Cannot GET /wp/…") — scanner noise, not our 404s. */
function isUnknownRoute(status: number, body: unknown): boolean {
  if (status !== (HttpStatus.NOT_FOUND as number)) return false;
  const message = (body as { message?: unknown } | null)?.message;
  return typeof message === 'string' && /^Cannot [A-Z]+ \//.test(message);
}
