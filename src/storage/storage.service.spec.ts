import {
  StorageNotConfiguredError,
  StorageService,
  photoKey,
  photoKeys,
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

  it('lowercases ids so iOS (uppercase) and Postgres (lowercase) agree', () => {
    expect(photoKey('u1', 'ABCD-EF')).toBe('photos/u1/abcd-ef.jpg');
    expect(photoKeys('u1', 'abcd-ef')).toEqual([
      'photos/u1/abcd-ef.jpg',
      'photos/u1/ABCD-EF.jpg',
    ]);
    expect(photoKeys('u1', '1234')).toEqual(['photos/u1/1234.jpg']);
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
  describe('probeUploads', () => {
    afterEach(() => jest.restoreAllMocks());

    it('uploads through a presigned PUT, then deletes the probe object', async () => {
      const service = createService(CONFIGURED);
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      const del = jest.spyOn(service, 'delete').mockResolvedValue();
      const error = jest.spyOn(service['logger'], 'error');

      await service.probeUploads();

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(new URL(url).pathname).toBe(
        '/photos-bucket/diagnostics/upload-probe.jpg',
      );
      expect(init.method).toBe('PUT');
      expect(del).toHaveBeenCalledWith('diagnostics/upload-probe.jpg');
      expect(error).not.toHaveBeenCalled();
    });

    it('logs an error (which alerts) when the bucket rejects the upload', async () => {
      const service = createService(CONFIGURED);
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('<Code>AccessDenied</Code>', { status: 403 }));
      const error = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);

      await service.probeUploads();

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('presigned PUT returned 403'),
      );
    });

    it('does nothing when storage is not configured', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      await createService({}).probeUploads();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
