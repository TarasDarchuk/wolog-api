import {
  BadRequestException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter.js';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let warn: jest.SpyInstance;
  let json: jest.Mock;

  function run(exception: Error, body: unknown = { notes: 'private note' }) {
    json = jest.fn();
    const response = { status: jest.fn(() => ({ json })) };
    const request = { method: 'POST', url: '/api/v1/sync/push', body };
    filter.catch(
      exception as never,
      {
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => response,
        }),
      } as never,
    );
    return response;
  }

  const firstLog = () => String((warn.mock.calls as unknown[][])[0][0]);

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => warn.mockRestore());

  it('logs 4xx with the redacted request body', () => {
    run(new BadRequestException('bad'));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(firstLog()).toContain('Body: {"notes":"private note"}');
  });

  it('logs 401 without the request body', () => {
    const response = run(new UnauthorizedException());

    expect(warn).toHaveBeenCalledTimes(1);
    expect(firstLog()).toContain('401 POST /api/v1/sync/push');
    expect(firstLog()).not.toContain('private note');
    expect(response.status).toHaveBeenCalledWith(401);
  });

  it('does not log router 404s for unknown paths', () => {
    const response = run(
      new NotFoundException('Cannot GET /wp/?rest_route=/'),
      undefined,
    );

    expect(warn).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(404);
  });

  it('still logs our own 404s', () => {
    run(new NotFoundException('Photo not found'));

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
