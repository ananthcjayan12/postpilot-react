export const secretNames = [
  'APP_ENCRYPTION_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'META_APP_ID',
  'META_APP_SECRET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
];
export function validate(env) {
  for (const key of [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'APP_ENCRYPTION_KEY',
    'ALLOWED_OWNER_EMAIL',
  ])
    if (!env[key]) throw new Error(`Missing ${key}. Configure GitHub secrets/variables.`);
  if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID)) throw new Error('Invalid Cloudflare account ID.');
  if (Buffer.from(env.APP_ENCRYPTION_KEY, 'base64').length !== 32)
    throw new Error('APP_ENCRYPTION_KEY must be 32 random bytes encoded as base64.');
  for (const [a, b] of [
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    ['META_APP_ID', 'META_APP_SECRET'],
    ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
  ])
    if (!!env[a] !== !!env[b]) throw new Error(`Supply both ${a} and ${b}, or neither.`);
  const name = env.WORKER_NAME || 'postpilot',
    database = env.D1_DATABASE_NAME || `${name}-db`,
    bucket = env.R2_BUCKET_NAME || `${name}-media`;
  for (const value of [name, database, bucket])
    if (!/^[a-z][a-z0-9-]{2,50}$/.test(value))
      throw new Error('Resource names must be 3–51 lowercase letters, digits, or hyphens.');
  if (env.APP_ORIGIN) {
    const url = new URL(env.APP_ORIGIN);
    if (url.protocol !== 'https:' || url.origin !== env.APP_ORIGIN)
      throw new Error('APP_ORIGIN must be an HTTPS origin without a path or trailing slash.');
  }
  if (!env.ALLOWED_OWNER_EMAIL.split(',').every((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())))
    throw new Error('ALLOWED_OWNER_EMAIL must contain comma-separated emails.');
  return { name, database, bucket };
}
export function cloudflare(env, fetcher = fetch) {
  return async (path, { method = 'GET', body, allow404 = false } = {}) => {
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      response = await fetcher(
        `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
      );
      if (method !== 'GET' || ![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) break;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
    if (response.status === 404 && allow404) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false)
      throw new Error(
        `Cloudflare ${method} ${path.split('?')[0]} failed (${response.status}; codes ${(data.errors || []).map((x) => x.code).join(',')}). Check token permissions and service activation.`,
      );
    return data.result;
  };
}
export async function ensureResource(find, create) {
  const found = await find();
  if (found) return { resource: found, created: false };
  try {
    return { resource: await create(), created: true };
  } catch (error) {
    const concurrent = await find();
    if (concurrent) return { resource: concurrent, created: false };
    throw error;
  }
}
export function mergeRule(existing, rule) {
  return [...(existing?.rules || []).filter((r) => r.id !== rule.id), rule];
}
