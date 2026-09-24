import type { Env } from './env';
export const now = () => new Date().toISOString();
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const random = () =>
  b64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
export async function hash(s: string) {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}
export async function encryptionKey(env: Env) {
  let bytes: Uint8Array;
  try {
    bytes = unb64(env.APP_ENCRYPTION_KEY);
  } catch {
    throw new AppError('Encryption key is not configured.', 503);
  }
  if (bytes.length !== 32) throw new AppError('Encryption key must be 32 bytes encoded as base64.', 503);
  return crypto.subtle.importKey('raw', bytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env: Env, value: unknown, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    await encryptionKey(env),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return JSON.stringify({ v: 1, iv: b64(iv), ciphertext: b64(new Uint8Array(encrypted)) });
}
export async function unseal<T = any>(env: Env, envelope: string, context: string): Promise<T> {
  const e = JSON.parse(envelope);
  if (e.v !== 1) throw new AppError('Unknown encryption key version.', 503);
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: unb64(e.iv) as BufferSource,
          additionalData: new TextEncoder().encode(context),
        },
        await encryptionKey(env),
        unb64(e.ciphertext) as BufferSource,
      ),
    ),
  );
}
export async function getCredential(env: Env, user: string, provider: string) {
  const row = await env.DB.prepare('SELECT envelope,version FROM credentials WHERE user_id=? AND provider=?')
    .bind(user, provider)
    .first<{ envelope: string; version: number }>();
  return row ? { value: await unseal(env, row.envelope, `${user}:${provider}`), version: row.version } : null;
}
export async function saveCredential(env: Env, user: string, provider: string, value: unknown) {
  const envelope = await seal(env, value, `${user}:${provider}`);
  await env.DB.prepare(
    'INSERT INTO credentials(user_id,provider,envelope) VALUES(?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET envelope=excluded.envelope,version=credentials.version+1',
  )
    .bind(user, provider, envelope)
    .run();
}
export async function signMedia(env: Env, id: string, expires: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    unb64(env.APP_ENCRYPTION_KEY) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`media:${id}:${expires}`))),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
export async function validMediaSignature(env: Env, id: string, expires: number, signature: string) {
  if (
    !Number.isSafeInteger(expires) ||
    expires < Date.now() ||
    expires > Date.now() + 7 * 86400000 ||
    !signature
  )
    return false;
  const expected = await signMedia(env, id, expires);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
export async function providerJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok || body.error)
    throw new AppError(
      `Provider request failed (${response.status}); check permissions, account status, and provider limits.`,
      502,
    );
  return body;
}
