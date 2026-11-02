import { Logger } from '@nestjs/common';
import { bodyParserErrorHandler } from './body-parser-error.handler.js';

describe('bodyParserErrorHandler', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  function run(err: unknown) {
    const json = jest.fn();
    const res = {
      headersSent: false,
      status: jest.fn(() => ({ json })),
      end: jest.fn(),
    };
    const next = jest.fn();
    bodyParserErrorHandler(
      err,
      { method: 'POST', url: '/api/v1/sync/push' } as never,
      res as never,
      next,
    );
    return { res, json, next };
  }

  function httpError(status: number, type: string, message: string) {
    return Object.assign(new Error(message), {
      status,
      statusCode: status,
      type,
    });
  }

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('ends an aborted request quietly, without an error log', () => {
    const { res, next } = run(
      httpError(400, 'request.aborted', 'request aborted'),
    );

    expect(res.end).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('answers malformed JSON with 400 and a warning', () => {
    const { res, json, next } = run(
      httpError(400, 'entity.parse.failed', 'Unexpected token } in JSON'),
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'Unexpected token } in JSON',
    });
    expect(next).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('answers an oversized body with 413', () => {
    const { res } = run(
      httpError(413, 'entity.too.large', 'request entity too large'),
    );
    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('passes anything else on to Nest', () => {
    const boom = new Error('boom');
    const { next, res } = run(boom);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
