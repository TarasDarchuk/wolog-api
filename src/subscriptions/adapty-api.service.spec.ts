import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ADAPTY_PROFILE_URL, AdaptyApiService } from './adapty-api.service';

const DAY = 24 * 60 * 60 * 1000;
const USER = '7d3f0c2e-8a41-4c55-9e2b-1f6a0b9c4d21';

describe('AdaptyApiService.premiumStatus', () => {
  let fetchMock: jest.SpyInstance;

  const service = (key: string | undefined = 'secret_live_x') =>
    new AdaptyApiService({
      get: (k: string) => (k === 'ADAPTY_SECRET_KEY' ? key : undefined),
    } as unknown as ConfigService);

  const respond = (status: number, body: unknown) =>
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );

  const profile = (levels: unknown[]) => ({
    data: { customer_user_id: USER, access_levels: levels },
  });

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('asks the server API by customer user id with the secret key', async () => {
    respond(200, profile([]));
    await service().premiumStatus(USER);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ADAPTY_PROFILE_URL);
    expect(init.headers).toEqual({
      Authorization: 'Api-Key secret_live_x',
      'adapty-customer-user-id': USER,
    });
  });

  it('reports premium with a future expiry as active', async () => {
    const expires = new Date(Date.now() + 7 * DAY);
    respond(
      200,
      profile([
        { access_level_id: 'premium', expires_at: expires.toISOString() },
      ]),
    );
    await expect(service().premiumStatus(USER)).resolves.toEqual({
      active: true,
      expiresAt: expires,
    });
  });

  it('reports an expired premium level as inactive', async () => {
    respond(
      200,
      profile([
        {
          access_level_id: 'premium',
          expires_at: new Date(Date.now() - DAY).toISOString(),
        },
      ]),
    );
    await expect(service().premiumStatus(USER)).resolves.toMatchObject({
      active: false,
    });
  });

  it('reports lifetime premium (no expiry) as active', async () => {
    respond(200, profile([{ access_level_id: 'premium', expires_at: null }]));
    await expect(service().premiumStatus(USER)).resolves.toEqual({
      active: true,
      expiresAt: null,
    });
  });

  it('ignores other access levels', async () => {
    respond(200, profile([{ access_level_id: 'other', expires_at: null }]));
    await expect(service().premiumStatus(USER)).resolves.toEqual({
      active: false,
      expiresAt: null,
    });
  });

  it('treats an unknown profile as no access', async () => {
    respond(400, {
      error_code: 'profile_does_not_exist',
      status_code: 400,
    });
    await expect(service().premiumStatus(USER)).resolves.toEqual({
      active: false,
      expiresAt: null,
    });
  });

  it('returns null on a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(service().premiumStatus(USER)).resolves.toBeNull();
  });

  it('returns null on a server error', async () => {
    respond(503, { error: 'unavailable' });
    await expect(service().premiumStatus(USER)).resolves.toBeNull();
  });

  it('returns null without calling Adapty when no key is configured', async () => {
    await expect(service('').premiumStatus(USER)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
