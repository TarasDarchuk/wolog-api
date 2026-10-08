import {
  StorageNotConfiguredError,
  StorageService,
  photoKey,
  photoPrefix,
} from './storage.service';

function createService(env: Record<string, string | undefined>) {
  const config = {
    get: jest.fn((key: string, def?: unknown) => env[key] ?? def),
  };
  return new StorageService(config as any);
}

const CONFIGURED = {
  S3_ENDPOINT: 'https://storage.example.com',
  S3_REGION: 'auto',
  S3_BUCKET: 'photos-bucket',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
};

describe('StorageService', () => {
  it('builds per-user photo keys', () => {
    expect(photoKey('u1', 'p1')).toBe('photos/u1/p1.jpg');
    expect(photoPrefix('u1')).toBe('photos/u1/');
  });

  it('presigns a path-style PUT and returns every signed header', async () => {
    const service = createService(CONFIGURED);

    const { url, headers } = await service.presignPut(
      'photos/u1/p1.jpg',
      'image/jpeg',
      412345,
    );

    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://storage.example.com');
    expect(parsed.pathname).toBe('/photos-bucket/photos/u1/p1.jpg');
    expect(Number(parsed.searchParams.get('X-Amz-Expires'))).toBe(900);
    // No default CRC32 checksum baked into the URL
    expect(url).not.toMatch(/checksum/i);

    const signed = parsed.searchParams
      .get('X-Amz-SignedHeaders')!
      .split(';')
      .filter((h) => h !== 'host');
    for (const name of signed) {
      expect(Object.keys(headers).map((h) => h.toLowerCase())).toContain(name);
    }
    expect(headers['Content-Type']).toBe('image/jpeg');
    if (signed.includes('content-length')) {
      expect(headers['Content-Length']).toBe('412345');
    }
  });

  it('presigns a GET valid for an hour', async () => {
    const service = createService(CONFIGURED);

    const url = await service.presignGet('photos/u1/p1.jpg');

    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('3600');
  });

  it('throws StorageNotConfiguredError when env vars are missing', async () => {
    const service = createService({});

    await expect(service.presignGet('k')).rejects.toBeInstanceOf(
      StorageNotConfiguredError,
    );
    await expect(service.deletePrefix('p/')).rejects.toBeInstanceOf(
      StorageNotConfiguredError,
    );
  });

  it('deleteQuietly swallows failures', async () => {
    const service = createService({});

    await expect(service.deleteQuietly(['a', 'b'])).resolves.toBeUndefined();
  });
});
