import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config, dataDir } from '../config.js';
import type { SecretShape } from '../types.js';

const filePath = path.resolve(dataDir, 'secrets.json');
const tmpPath = `${filePath}.tmp`;

type Envelope = { iv: string; tag: string; ciphertext: string };

function key(): Buffer {
  if (!config.encryptionKey) {
    throw new Error('APP_ENCRYPTION_KEY is missing. Run `npm run setup` or set it in .env.');
  }
  try {
    const raw = Buffer.from(config.encryptionKey, 'base64');
    if (raw.length === 32) return raw;
  } catch {}
  return createHash('sha256').update(config.encryptionKey).digest();
}

function encrypt(value: SecretShape): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

function decrypt(env: Envelope): SecretShape {
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(env.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(env.ciphertext, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as SecretShape;
}

export async function loadSecrets(): Promise<SecretShape> {
  try {
    const env = JSON.parse(await readFile(filePath, 'utf8')) as Envelope;
    return decrypt(env);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {};
    if (!config.encryptionKey) return {};
    throw error;
  }
}

export async function saveSecrets(secrets: SecretShape): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const env = encrypt(secrets);
  await writeFile(tmpPath, `${JSON.stringify(env, null, 2)}\n`, 'utf8');
  await rename(tmpPath, filePath);
}

export async function mutateSecrets<T>(fn: (secrets: SecretShape) => T | Promise<T>): Promise<T> {
  const secrets = await loadSecrets();
  const value = await fn(secrets);
  await saveSecrets(secrets);
  return value;
}
