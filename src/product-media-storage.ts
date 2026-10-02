import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export type MediaMetadata = { contentType: string; byteSize: number };
export type ProductMediaStorage = {
  put(key: string, bytes: Uint8Array, metadata: MediaMetadata): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  read(key: string): Promise<{ bytes: Uint8Array; metadata: MediaMetadata } | null>;
  publicUrl(key: string): string;
};

const cacheControl = 'public, max-age=31536000, immutable';
export const validProductMediaKey = (key: string) => /^(?:[a-f0-9]{32}\.(?:jpg|png|webp)|products\/[0-9a-f-]{36}\/[a-f0-9]{32}\.(?:jpg|png|webp))$/.test(key);
function assertKey(key: string) { if (!validProductMediaKey(key)) throw new Error('INVALID_STORAGE_KEY'); }
const contentTypeForKey = (key: string) => key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

export class LocalProductMediaStorage implements ProductMediaStorage {
  private readonly root: string;
  constructor(root = resolve(process.env.PRODUCT_UPLOAD_DIR ?? join(process.cwd(), 'uploads', 'products'))) { this.root = resolve(root); }
  private path(key: string) { assertKey(key); const path = resolve(this.root, ...key.split('/')); if (!path.startsWith(`${this.root}${sep}`)) throw new Error('INVALID_STORAGE_PATH'); return path; }
  async put(key: string, bytes: Uint8Array) { const path = this.path(key); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { flag: 'wx' }); }
  async delete(key: string) { try { await unlink(this.path(key)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  async exists(key: string) { try { await stat(this.path(key)); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
  async read(key: string) { try { const path = this.path(key); const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]); return { bytes, metadata: { contentType: contentTypeForKey(key), byteSize: metadata.size } }; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } }
  publicUrl(key: string) { assertKey(key); return `/api/v1/public/media/products/${key}`; }
}

type S3CommandClient = { send(command: unknown): Promise<Record<string, unknown>> };
export class R2ProductMediaStorage implements ProductMediaStorage {
  private readonly client: S3CommandClient;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  constructor(bucket: string, publicBaseUrl: string, client: S3CommandClient) {
    const base = new URL(publicBaseUrl);
    if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash || base.hostname.endsWith('.r2.dev') || base.hostname.endsWith('.r2.cloudflarestorage.com')) throw new Error('R2_PUBLIC_BASE_URL must be an HTTPS custom media origin.');
    this.bucket = bucket;
    this.publicBaseUrl = base.origin;
    this.client = client;
  }
  async put(key: string, bytes: Uint8Array, metadata: MediaMetadata) { assertKey(key); await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: metadata.contentType, ContentLength: metadata.byteSize, CacheControl: cacheControl })); }
  async delete(key: string) { assertKey(key); await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
  async exists(key: string) { assertKey(key); try { await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); return true; } catch (error) { if ((error as { name?: string }).name === 'NotFound' || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false; throw error; } }
  async read(key: string) { assertKey(key); try { const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })); const body = result.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined; if (!body?.transformToByteArray) throw new Error('R2 response has no readable body.'); const bytes = await body.transformToByteArray(); return { bytes, metadata: { contentType: String(result.ContentType ?? 'application/octet-stream'), byteSize: Number(result.ContentLength ?? bytes.byteLength) } }; } catch (error) { if ((error as { name?: string }).name === 'NoSuchKey' || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null; throw error; } }
  publicUrl(key: string) { assertKey(key); return `${this.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`; }
}

export function createProductMediaStorage(environment = process.env): ProductMediaStorage {
  const runtime = environment.TCM_ENVIRONMENT ?? environment.NODE_ENV ?? 'development';
  if (runtime !== 'production') return new LocalProductMediaStorage(environment.PRODUCT_UPLOAD_DIR ? resolve(environment.PRODUCT_UPLOAD_DIR) : undefined);
  const accountId = environment.R2_ACCOUNT_ID;
  const accessKeyId = environment.R2_ACCESS_KEY_ID;
  const secretAccessKey = environment.R2_SECRET_ACCESS_KEY;
  const bucket = environment.R2_BUCKET_NAME;
  const publicBaseUrl = environment.R2_PUBLIC_BASE_URL;
  if (![accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl].every((value) => value?.trim())) throw new Error('Production product media requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, and R2_PUBLIC_BASE_URL.');
  if (!/^[a-f0-9]{32}$/i.test(accountId!) || bucket !== 'tiem-cua-may-products') throw new Error('Production product media must use a valid Cloudflare account ID and the isolated tiem-cua-may-products bucket.');
  const client = new S3Client({ region: 'auto', endpoint: `https://${accountId}.r2.cloudflarestorage.com`, forcePathStyle: true, credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! } });
  return new R2ProductMediaStorage(bucket!, publicBaseUrl!, client);
}

export const productMediaStorage = createProductMediaStorage();
