import { redactSensitive, safeBodyForLog } from './redact.js';

describe('redactSensitive', () => {
  it('redacts OAuth token-endpoint secrets (code, verifier, refresh, client secret)', () => {
    const body = {
      grant_type: 'authorization_code',
      code: 'wlgc_secretcode',
      code_verifier: 'verifier123',
      refresh_token: 'wlgr_secret',
      client_secret: 'shhh',
      client_id: 'client-1',
      redirect_uri: 'https://claude.ai/cb',
    };
    expect(redactSensitive(body)).toEqual({
      grant_type: 'authorization_code',
      code: '[REDACTED]',
      code_verifier: '[REDACTED]',
      refresh_token: '[REDACTED]',
      client_secret: '[REDACTED]',
      client_id: 'client-1',
      redirect_uri: 'https://claude.ai/cb',
    });
  });

  it('redacts the identity credential in a consent body but keeps public fields', () => {
    const body = {
      decision: 'allow',
      provider: 'apple',
      credential: 'eyJhbGci.realAppleIdToken.sig',
      authorize: {
        client_id: 'client-1',
        code_challenge: 'public-hash',
        redirect_uri: 'https://claude.ai/cb',
      },
    };
    const result = redactSensitive(body) as any;
    expect(result.credential).toBe('[REDACTED]');
    // Public OAuth params are fine to log.
    expect(result.authorize.code_challenge).toBe('public-hash');
    expect(result.authorize.client_id).toBe('client-1');
  });

  it('redacts app auth tokens (identityToken, idToken, refreshToken)', () => {
    expect(redactSensitive({ identityToken: 'a', deviceName: 'iPhone' })).toEqual(
      { identityToken: '[REDACTED]', deviceName: 'iPhone' },
    );
    expect(redactSensitive({ idToken: 'a' })).toEqual({ idToken: '[REDACTED]' });
    expect(redactSensitive({ refreshToken: 'a' })).toEqual({
      refreshToken: '[REDACTED]',
    });
  });

  it('matches keys regardless of case/punctuation style', () => {
    expect(redactSensitive({ Code_Verifier: 'x', ACCESS_TOKEN: 'y' })).toEqual({
      Code_Verifier: '[REDACTED]',
      ACCESS_TOKEN: '[REDACTED]',
    });
  });

  it('recurses into nested objects and arrays', () => {
    const body = { items: [{ token: 'a' }, { name: 'ok' }] };
    expect(redactSensitive(body)).toEqual({
      items: [{ token: '[REDACTED]' }, { name: 'ok' }],
    });
  });

  it('leaves non-sensitive routine payloads untouched', () => {
    const body = {
      name: 'Upper A',
      items: [{ exercise: { name: 'Bench Press', targetSets: 4 } }],
    };
    expect(redactSensitive(body)).toEqual(body);
  });

  it('does not blow the stack on deeply nested input', () => {
    let nested: any = { token: 'deep' };
    for (let i = 0; i < 50; i++) nested = { child: nested };
    expect(() => redactSensitive(nested)).not.toThrow();
  });
});

describe('safeBodyForLog', () => {
  it('returns empty string for null/undefined bodies', () => {
    expect(safeBodyForLog(undefined)).toBe('');
    expect(safeBodyForLog(null)).toBe('');
  });

  it('serializes a redacted body', () => {
    expect(safeBodyForLog({ code: 'secret', grant_type: 'x' })).toBe(
      '{"code":"[REDACTED]","grant_type":"x"}',
    );
  });

  it('truncates oversized bodies', () => {
    const big = { note: 'x'.repeat(5000) };
    const out = safeBodyForLog(big);
    expect(out.length).toBeLessThan(2100);
    expect(out.endsWith('…[truncated]')).toBe(true);
  });

  it('never leaks a secret even when truncating', () => {
    const body = { code: 'TOPSECRET', filler: 'y'.repeat(5000) };
    expect(safeBodyForLog(body)).not.toContain('TOPSECRET');
  });
});
