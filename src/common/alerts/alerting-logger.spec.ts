import { AlertingLogger } from './alerting-logger.js';

describe('AlertingLogger', () => {
  let send: jest.Mock;
  let now: number;

  function makeLogger(target = { botToken: 'TOKEN', chatId: '42' }) {
    const logger = new AlertingLogger(
      target,
      'production',
      send as unknown as typeof fetch,
      () => now,
    );
    // Keep test output quiet; we only care about what goes to Telegram.
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    return logger;
  }

  function sentTexts(): string[] {
    return send.mock.calls.map(
      ([, init]: [string, RequestInit]) =>
        (JSON.parse(init.body as string) as { text: string }).text,
    );
  }

  beforeEach(() => {
    send = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    now = 1_000_000;
  });

  afterEach(() => jest.restoreAllMocks());

  it('forwards error logs with context and stack', () => {
    const logger = makeLogger();
    logger.error('Unknown: UnknownError', 'at S3 handler', 'ExceptionsHandler');

    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls as unknown[][])[0][0]).toBe(
      'https://api.telegram.org/botTOKEN/sendMessage',
    );
    const [text] = sentTexts();
    expect(text).toContain('wolog-api [production] ExceptionsHandler');
    expect(text).toContain('Unknown: UnknownError');
    expect(text).toContain('at S3 handler');
  });

  it('includes the stack of an Error logged with only a context', () => {
    const logger = makeLogger();
    const error = new Error('boom');
    logger.error(error, 'TemplateSyncService');

    const [text] = sentTexts();
    expect(text).toContain('Error: boom');
    expect(text).toContain(error.stack!.split('\n')[1].trim());
  });

  it('includes an Error passed as the cause of a message', () => {
    const logger = makeLogger();
    logger.error(
      'Failed to push workout W',
      new Error('Unique constraint'),
      'WorkoutSyncService',
    );

    const [text] = sentTexts();
    expect(text).toContain('Failed to push workout W');
    expect(text).toContain('Error: Unique constraint');
  });

  it('does not alert on warnings', () => {
    makeLogger().warn('401 POST /api/v1/sync/push', 'HTTP');
    expect(send).not.toHaveBeenCalled();
  });

  it('deduplicates repeats within 30 minutes and reports the count later', () => {
    const logger = makeLogger();
    logger.error('Failed to push template X', 'TemplateSyncService');
    logger.error('Failed to push template X', 'TemplateSyncService');
    logger.error('Failed to push template X', 'TemplateSyncService');
    expect(send).toHaveBeenCalledTimes(1);

    now += 31 * 60 * 1000;
    logger.error('Failed to push template X', 'TemplateSyncService');
    expect(send).toHaveBeenCalledTimes(2);
    expect(sentTexts()[1]).toContain('+2 more like this');
  });

  it('caps alerts per hour', () => {
    const logger = makeLogger();
    for (let i = 0; i < 30; i++) logger.error(`error ${i}`, 'Ctx');
    expect(send).toHaveBeenCalledTimes(20);
  });

  it('is a plain console logger without a Telegram target', () => {
    const logger = makeLogger(null as never);
    logger.error('boom', 'Ctx');
    expect(send).not.toHaveBeenCalled();
  });

  it('swallows delivery failures', async () => {
    send.mockRejectedValue(new Error('network down'));
    const logger = makeLogger();
    expect(() => logger.error('boom', 'Ctx')).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
