// Storage abstraction layer supporting R2 and S3-compatible storage

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export interface StorageMetadata {
  contentType?: string;
  customMetadata?: Record<string, string>;
}

export interface StorageObject {
  body: ReadableStream<Uint8Array>;
  contentType?: string;
  customMetadata?: Record<string, string>;
}

export interface StorageService {
  put(key: string, body: ArrayBuffer | ReadableStream, metadata?: StorageMetadata): Promise<void>;
  get(key: string): Promise<StorageObject | null>;
  delete(key: string): Promise<void>;
}

// R2 storage implementation (uses native Cloudflare R2 binding)
export class R2Storage implements StorageService {
  constructor(private bucket: R2Bucket) {}

  async put(key: string, body: ArrayBuffer | ReadableStream, metadata?: StorageMetadata): Promise<void> {
    await this.bucket.put(key, body, {
      httpMetadata: metadata?.contentType ? { contentType: metadata.contentType } : undefined,
      customMetadata: metadata?.customMetadata,
    });
  }

  async get(key: string): Promise<StorageObject | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;

    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType,
      customMetadata: object.customMetadata,
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}

// S3-compatible storage implementation
export class S3Storage implements StorageService {
  private client: S3Client;
  private bucket: string;

  constructor(config: {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  }) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true, // Required for most S3-compatible services (MinIO, etc.)
    });
  }

  async put(key: string, body: ArrayBuffer | ReadableStream, metadata?: StorageMetadata): Promise<void> {
    // Convert ReadableStream to Uint8Array for S3 SDK
    let bodyBuffer: Uint8Array;
    if (body instanceof ArrayBuffer) {
      bodyBuffer = new Uint8Array(body);
    } else {
      const chunks: Uint8Array[] = [];
      const reader = body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      bodyBuffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        bodyBuffer.set(chunk, offset);
        offset += chunk.length;
      }
    }

    // Encode custom metadata as x-amz-meta-* headers
    const s3Metadata: Record<string, string> = {};
    if (metadata?.customMetadata) {
      for (const [k, v] of Object.entries(metadata.customMetadata)) {
        s3Metadata[k] = v;
      }
    }

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bodyBuffer,
      ContentType: metadata?.contentType,
      Metadata: Object.keys(s3Metadata).length > 0 ? s3Metadata : undefined,
    }));
  }

  async get(key: string): Promise<StorageObject | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));

      if (!response.Body) return null;

      // Convert SDK stream to web ReadableStream
      const webStream = response.Body.transformToWebStream();

      return {
        body: webStream,
        contentType: response.ContentType,
        customMetadata: response.Metadata,
      };
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }
}

// Factory function to create storage service based on environment configuration
export function createStorageService(env: {
  MEDIA?: R2Bucket;
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_BUCKET?: string;
}): StorageService {
  // If S3 configuration is provided, use S3 storage
  if (env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET) {
    return new S3Storage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION || 'auto',
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      bucket: env.S3_BUCKET,
    });
  }

  // Default to R2 storage
  if (!env.MEDIA) {
    throw new Error('No storage configured: either provide MEDIA (R2) binding or S3_* environment variables');
  }

  return new R2Storage(env.MEDIA);
}
