import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { parse } from 'jsonc-parser';
import { validate, cloudflare, ensureResource, mergeRule } from './config.mjs';
export async function provision(env = process.env) {
  const names = validate(env),
    cf = cloudflare(env);
  const db = await ensureResource(
    async () => {
      const matches = [];
      for (let page = 1; ; page++) {
        const rows = await cf(
          `/d1/database?name=${encodeURIComponent(names.database)}&per_page=100&page=${page}`,
        );
        matches.push(...rows.filter((r) => r.name === names.database));
        if (rows.length < 100) break;
      }
      if (matches.length > 1) throw new Error('Ambiguous D1 name.');
      return matches[0];
    },
    () => cf('/d1/database', { method: 'POST', body: { name: names.database } }),
  );
  const bucket = await ensureResource(
    () => cf(`/r2/buckets/${names.bucket}`, { allow404: true }),
    () => cf('/r2/buckets', { method: 'POST', body: { name: names.bucket, storageClass: 'Standard' } }),
  );
  // Refuse an existing publicly exposed bucket rather than changing access silently.
  const managed = await cf(`/r2/buckets/${names.bucket}/domains/managed`);
  const custom = await cf(`/r2/buckets/${names.bucket}/domains/custom`);
  if (managed?.enabled || custom?.domains?.some((d) => d.enabled !== false))
    throw new Error(
      'The media bucket is public. Use a dedicated private bucket or disable public access before deployment.',
    );
  let origin = env.APP_ORIGIN;
  if (!origin) {
    const subdomain = await cf('/workers/subdomain');
    if (!subdomain?.subdomain) throw new Error('Configure your Workers subdomain in Cloudflare first.');
    origin = `https://${names.name}.${subdomain.subdomain}.workers.dev`;
  }
  const cors = await cf(`/r2/buckets/${names.bucket}/cors`, { allow404: true });
  await cf(`/r2/buckets/${names.bucket}/cors`, {
    method: 'PUT',
    body: {
      rules: mergeRule(cors, {
        id: 'postpilot-upload',
        allowed: { origins: [origin], methods: ['PUT'], headers: ['content-type'] },
        exposeHeaders: ['ETag'],
        maxAgeSeconds: 3600,
      }),
    },
  });
  const lifecycle = await cf(`/r2/buckets/${names.bucket}/lifecycle`);
  await cf(`/r2/buckets/${names.bucket}/lifecycle`, {
    method: 'PUT',
    body: {
      rules: mergeRule(lifecycle, {
        id: 'postpilot-abort-incomplete',
        enabled: true,
        conditions: { prefix: '' },
        abortMultipartUploadsTransition: { condition: { type: 'Age', maxAge: 172800 } },
      }),
    },
  });
  const errors = [];
  const config = parse(await readFile('wrangler.jsonc', 'utf8'), errors, { allowTrailingComma: true });
  if (errors.length) throw new Error('Invalid base Wrangler JSONC configuration.');
  Object.assign(config, { name: names.name, account_id: env.CLOUDFLARE_ACCOUNT_ID });
  config.d1_databases[0].database_name = names.database;
  config.d1_databases[0].database_id = db.resource.uuid || db.resource.id;
  if (!config.d1_databases[0].database_id) throw new Error('Cloudflare did not return a database ID.');
  config.r2_buckets[0].bucket_name = names.bucket;
  config.workflows[0].name = `${names.name}-publish`;
  config.vars = {
    APP_ORIGIN: origin,
    ALLOWED_OWNER_EMAIL: env.ALLOWED_OWNER_EMAIL,
    LOCAL_UPLOADS: 'false',
    META_GRAPH_VERSION: env.META_GRAPH_VERSION || 'v25.0',
    META_PAGE_ID: env.META_PAGE_ID || '',
    R2_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
    R2_BUCKET_NAME: names.bucket,
    STORAGE_QUOTA_BYTES: env.STORAGE_QUOTA_BYTES || '53687091200',
  };
  // A supplied custom domain is bound in the same deployment; the zone must already be on Cloudflare.
  if (!new URL(origin).hostname.endsWith('.workers.dev'))
    config.routes = [{ pattern: new URL(origin).hostname, custom_domain: true }];
  await writeFile('wrangler.generated.json', JSON.stringify(config, null, 2) + '\n');
  const state = {
    ...names,
    origin,
    databaseId: config.d1_databases[0].database_id,
    databaseCreated: db.created,
    bucketCreated: bucket.created,
  };
  await writeFile('.cloudflare-state.json', JSON.stringify(state, null, 2));
  const summary = `\n### Cloudflare resources\n\n- D1: ${names.database} (${db.created ? 'created' : 'reused'})\n- Private R2: ${names.bucket} (${bucket.created ? 'created' : 'reused'})\n- Application: ${origin}\n- Studio sign-in: ${origin}/api/auth/google/callback\n- YouTube: ${origin}/api/oauth/google/callback\n- Meta: ${origin}/api/oauth/meta/callback\n`;
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  return state;
}
if (process.argv[1]?.endsWith('/provision.mjs'))
  provision().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
