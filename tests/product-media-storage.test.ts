import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { R2ProductMediaStorage } from '../src/product-media-storage.ts';

const key = 'products/ab8c1000-1234-4567-8901-123456789abc/0123456789abcdef0123456789abcdef.webp';
class MockS3 {
  commands: unknown[] = [];
  response: Record<string, unknown> = {};
  error: Error | null = null;
  async send(command: unknown) { this.commands.push(command); if (this.error) throw this.error; return this.response; }
}

test('R2 adapter writes immutable object key, bytes, type, size and cache metadata', async () => {
  const client = new MockS3(); const storage = new R2ProductMediaStorage('tiem-cua-may-products', 'https://media.example.test', client);
  const bytes = Buffer.from('fixture'); await storage.put(key, bytes, { contentType: 'image/webp', byteSize: bytes.length });
  const command = client.commands[0] as PutObjectCommand;
  assert.ok(command instanceof PutObjectCommand);
  assert.equal(command.input.Bucket, 'tiem-cua-may-products'); assert.equal(command.input.Key, key);
  assert.equal(command.input.ContentType, 'image/webp'); assert.equal(command.input.ContentLength, bytes.length);
  assert.equal(command.input.CacheControl, 'public, max-age=31536000, immutable'); assert.equal(Buffer.from(command.input.Body as Uint8Array).toString(), 'fixture');
});

test('R2 adapter checks existence, reads bytes and metadata, and deletes by the same key', async () => {
  const client = new MockS3(); const storage = new R2ProductMediaStorage('tiem-cua-may-products', 'https://media.example.test', client);
  client.response = {};
  assert.equal(await storage.exists(key), true); assert.ok(client.commands[0] instanceof HeadObjectCommand);
  client.response = { Body: { transformToByteArray: async () => Uint8Array.from([1,2,3]) }, ContentType: 'image/png', ContentLength: 3 };
  const read = await storage.read(key); assert.deepEqual([...read!.bytes], [1,2,3]); assert.deepEqual(read!.metadata, { contentType: 'image/png', byteSize: 3 }); assert.ok(client.commands[1] instanceof GetObjectCommand);
  await storage.delete(key); assert.ok(client.commands[2] instanceof DeleteObjectCommand); assert.equal((client.commands[2] as DeleteObjectCommand).input.Key, key);
});

test('R2 adapter maps missing objects to false/null and exposes only the configured custom media URL', async () => {
  const client = new MockS3(); const storage = new R2ProductMediaStorage('tiem-cua-may-products', 'https://media.example.test/', client);
  client.error = Object.assign(new Error('missing'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
  assert.equal(await storage.exists(key), false); assert.equal(await storage.read(key), null);
  assert.equal(storage.publicUrl(key), `https://media.example.test/${key}`);
  assert.throws(() => storage.publicUrl('../outside.png'), /INVALID_STORAGE_KEY/);
  assert.throws(() => new R2ProductMediaStorage('bucket', 'https://account.r2.dev', client), /custom media origin/);
  assert.throws(() => new R2ProductMediaStorage('bucket', 'https://account.r2.cloudflarestorage.com', client), /custom media origin/);
});
