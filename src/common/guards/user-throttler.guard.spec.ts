import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import type {
  ConnectorAuthGuard,
  ConnectorRequest,
} from './connector-auth.guard.js';
import { UserThrottlerGuard } from './user-throttler.guard.js';

describe('UserThrottlerGuard.getTracker', () => {
  const authenticate = jest.fn();
  const guard = new UserThrottlerGuard(
    [{ ttl: 60000, limit: 60 }],
    new ThrottlerStorageService(),
    new Reflector(),
    { authenticate } as unknown as ConnectorAuthGuard,
  );
  const track = (req: object): Promise<string> =>
    (
      guard as unknown as {
        getTracker(r: object): Promise<string>;
      }
    ).getTracker(req);

  beforeEach(() => authenticate.mockReset());

  it('keys on the user set by the global JWT guard', async () => {
    const key = await track({ user: { id: 'u1' }, ip: '1.2.3.4', headers: {} });
    expect(key).toBe('user:u1');
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('resolves connector bearer tokens to the user', async () => {
    authenticate.mockImplementation((req: ConnectorRequest) => {
      req.user = { id: 'u2' };
      req.authScopes = ['history:read'];
      return Promise.resolve(true);
    });
    const key = await track({
      ip: '1.2.3.4',
      headers: { authorization: 'Bearer wlga_x' },
    });
    expect(key).toBe('user:u2');
  });

  it('falls back to the IP for invalid tokens', async () => {
    authenticate.mockResolvedValue(false);
    const key = await track({
      ip: '1.2.3.4',
      headers: { authorization: 'Bearer junk' },
    });
    expect(key).toBe('1.2.3.4');
  });

  it('uses the IP for anonymous requests without a lookup', async () => {
    expect(await track({ ip: '5.6.7.8', headers: {} })).toBe('5.6.7.8');
    expect(authenticate).not.toHaveBeenCalled();
  });
});
