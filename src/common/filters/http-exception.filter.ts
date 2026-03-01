import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();

    if (status >= 400 && status < 500) {
      this.logger.warn(
        `${status} ${request.method} ${request.url} | ` +
          `Body: ${JSON.stringify(request.body)} | ` +
          `Error: ${JSON.stringify(exception.getResponse())}`,
      );
    }

    response.status(status).json(exception.getResponse());
  }
}
