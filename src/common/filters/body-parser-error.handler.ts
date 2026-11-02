import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

interface BodyParserError {
  status: number;
  type?: string;
  message: string;
}

function isClientBodyError(err: unknown): err is BodyParserError {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * Express error middleware for body-parser failures, mounted right after the
 * parsers. Without it they reach Nest's ExceptionsHandler, which logs every
 * non-HttpException at error level — so a phone dropping its connection
 * mid-upload ("request aborted") or a malformed JSON body paged Telegram.
 * These are client problems: log a warning and answer like Nest would.
 */
export function bodyParserErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isClientBodyError(err)) return next(err);

  logger.warn(
    `${err.status} ${req.method} ${req.url} | Body parser: ${err.type ?? 'unknown'} (${err.message})`,
  );

  // The client is gone; there is nobody to answer.
  if (err.type === 'request.aborted' || res.headersSent) {
    res.end();
    return;
  }
  res.status(err.status).json({ statusCode: err.status, message: err.message });
}
