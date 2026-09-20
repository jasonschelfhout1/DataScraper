import { createHash } from 'node:crypto';
import { PassThrough, type Readable } from 'node:stream';
import { Upload } from '@aws-sdk/lib-storage';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { sanitizeFilename } from '../filenames.js';
import { requireObjectStorageConfig } from '../config.js';

export interface PutResult { sha256: string; bytes: number; key: string }
export interface ObjectStore { put(key: string, stream: Readable, contentType?: string): Promise<PutResult>; exists(key: string): Promise<boolean>; signedDownloadUrl(key: string, filename: string): Promise<string>; delete(key: string): Promise<void> }

export function archiveObjectKey(projectNumber: string, documentUuid: string, filename: string): string {
  return `projects/${projectNumber}/${documentUuid}/${sanitizeFilename(filename)}`;
}

export class R2ObjectStore implements ObjectStore {
  private readonly config = requireObjectStorageConfig();
  private readonly client = new S3Client({ region: this.config.region, endpoint: this.config.endpoint, credentials: { accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey } });
  async put(key: string, stream: Readable, contentType?: string): Promise<PutResult> {
    const digest = createHash('sha256'); let bytes = 0; const body = new PassThrough();
    stream.on('data', (chunk: Buffer) => { digest.update(chunk); bytes += chunk.length; });
    stream.pipe(body);
    const upload = new Upload({ client: this.client, params: { Bucket: this.config.bucket, Key: key, Body: body, ...(contentType ? { ContentType: contentType } : {}) }, leavePartsOnError: false });
    try { await upload.done(); } catch (error) { await this.delete(key).catch(() => undefined); throw error; }
    if (bytes === 0) throw new Error('Refusing to archive an empty upstream document.');
    return { key, sha256: digest.digest('hex'), bytes };
  }
  async exists(key: string): Promise<boolean> { try { await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key })); return true; } catch { return false; } }
  signedDownloadUrl(key: string, filename: string): Promise<string> { return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key, ResponseContentDisposition: `attachment; filename="${sanitizeFilename(filename)}"` }), { expiresIn: 60 }); }
  async delete(key: string): Promise<void> { await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key })); }
}

export class MemoryObjectStore implements ObjectStore {
  private readonly values = new Map<string, Buffer>();
  async put(key: string, stream: Readable): Promise<PutResult> { const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); const value = Buffer.concat(chunks); if (!value.length) throw new Error('Refusing to archive an empty upstream document.'); this.values.set(key, value); return { key, bytes: value.length, sha256: createHash('sha256').update(value).digest('hex') }; }
  async exists(key: string): Promise<boolean> { return this.values.has(key); }
  async signedDownloadUrl(key: string): Promise<string> { if (!this.values.has(key)) throw new Error('Archive object not found.'); return `memory://${key}`; }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}
