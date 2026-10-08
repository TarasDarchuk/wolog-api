import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PUT_URL_TTL_SECONDS = 15 * 60;
const GET_URL_TTL_SECONDS = 60 * 60;

export class StorageNotConfiguredError extends Error {
  constructor() {
    super('Object storage is not configured (S3_* env vars missing)');
  }
}

export interface PresignedPut {
  url: string;
  // Every header that is part of the signature (except host) — the client
  // must send exactly these.
  headers: Record<string, string>;
}

/** Object key for a photo (workout or measurement progress photo). */
export function photoKey(userId: string, photoId: string): string {
  return `photos/${userId}/${photoId}.jpg`;
}

export function photoPrefix(userId: string): string {
  return `photos/${userId}/`;
}

/**
 * Thin wrapper over an S3-compatible bucket (Railway bucket). Path-style
 * addressing is required by Railway. Without the S3_* env vars the service
 * still constructs (local dev / tests) but every call throws
 * StorageNotConfiguredError.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string | undefined;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>('S3_ENDPOINT');
    const accessKeyId = config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('S3_SECRET_ACCESS_KEY');
    this.bucket = config.get<string>('S3_BUCKET');

    if (endpoint && accessKeyId && secretAccessKey && this.bucket) {
      this.client = new S3Client({
        endpoint,
        region: config.get<string>('S3_REGION', 'auto'),
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
        // Default CRC32 checksums would be signed into presigned PUT URLs
        // (computed over an empty body) and break client uploads.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    } else {
      this.client = null;
      this.logger.warn('S3_* env vars not set — photo storage disabled');
    }
  }

  async presignPut(
    key: string,
    contentType: string,
    contentLength: number,
  ): Promise<PresignedPut> {
    const client = this.requireClient();
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      { expiresIn: PUT_URL_TTL_SECONDS },
    );

    const values: Record<string, string> = {
      'content-type': contentType,
      'content-length': String(contentLength),
    };
    const canonicalNames: Record<string, string> = {
      'content-type': 'Content-Type',
      'content-length': 'Content-Length',
    };
    const signed = (new URL(url).searchParams.get('X-Amz-SignedHeaders') ?? '')
      .split(';')
      .filter((h) => h && h !== 'host');

    const headers: Record<string, string> = {};
    for (const name of signed) {
      if (!(name in values)) {
        // A signed header we don't know the value of would make the
        // upload fail with SignatureDoesNotMatch — fail loudly instead.
        throw new Error(`Unexpected signed header in presigned PUT: ${name}`);
      }
      headers[canonicalNames[name]] = values[name];
    }
    // Content-Type is always required by the contract, even if unsigned.
    headers['Content-Type'] = contentType;
    return { url, headers };
  }

  async presignGet(key: string): Promise<string> {
    const client = this.requireClient();
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: GET_URL_TTL_SECONDS },
    );
  }

  /** Returns the object's size, or null if it doesn't exist. */
  async head(key: string): Promise<{ contentLength: number } | null> {
    const client = this.requireClient();
    try {
      const res = await client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { contentLength: res.ContentLength ?? 0 };
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        (error.$metadata?.httpStatusCode === 404 || error.name === 'NotFound')
      ) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const client = this.requireClient();
    await client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /** Deletes every object under `prefix`. Returns the number deleted. */
  async deletePrefix(prefix: string): Promise<number> {
    const client = this.requireClient();
    let deleted = 0;
    let continuationToken: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (page.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => !!k);
      if (keys.length) {
        const res = await client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        if (res.Errors?.length) {
          throw new Error(
            `Failed to delete ${res.Errors.length} object(s) under ${prefix}`,
          );
        }
        deleted += keys.length;
      }
      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return deleted;
  }

  /**
   * Best-effort delete of several objects — failures are logged, never
   * thrown. Used after DB rows are already gone.
   */
  async deleteQuietly(keys: string[]): Promise<void> {
    await Promise.all(
      keys.map(async (key) => {
        try {
          await this.delete(key);
        } catch (error) {
          this.logger.error(`Failed to delete storage object ${key}`, error);
        }
      }),
    );
  }

  private requireClient(): S3Client {
    if (!this.client) throw new StorageNotConfiguredError();
    return this.client;
  }
}
