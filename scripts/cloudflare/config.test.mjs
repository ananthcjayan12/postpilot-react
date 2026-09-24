import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudflare, ensureResource, mergeRule, validate } from './config.mjs';
test('permission failure is not absence', async () => {
  const cf = cloudflare(
    { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 'secret' },
    async () => new Response('{}', { status: 403 }),
  );
  await assert.rejects(cf('/r2/buckets/private', { allow404: true }), /403/);
});
test('missing resource is created once and existing resource reused', async () => {
  let value = null,
    count = 0;
  const find = async () => value,
    create = async () => {
      count++;
      return (value = { id: 'db' });
    };
  assert.equal((await ensureResource(find, create)).created, true);
  assert.equal((await ensureResource(find, create)).created, false);
  assert.equal(count, 1);
});
test('concurrent creation is reconciled', async () => {
  let count = 0;
  const result = await ensureResource(
    async () => (++count === 1 ? null : { id: 'existing' }),
    async () => {
      throw Error('conflict');
    },
  );
  assert.equal(result.created, false);
});
test('managed bucket rules preserve unrelated configuration', () => {
  assert.deepEqual(
    mergeRule({ rules: [{ id: 'unrelated' }, { id: 'postpilot' }] }, { id: 'postpilot', enabled: true }),
    [{ id: 'unrelated' }, { id: 'postpilot', enabled: true }],
  );
});
test('configuration rejects partial credential pairs and insecure origins', () => {
  const env = {
    CLOUDFLARE_API_TOKEN: 'token',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    APP_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    ALLOWED_OWNER_EMAIL: 'owner@example.com',
  };
  assert.throws(() => validate({ ...env, GOOGLE_CLIENT_ID: 'id' }), /both/);
  assert.throws(() => validate({ ...env, APP_ORIGIN: 'http://example.com' }), /HTTPS/);
  assert.equal(validate(env).name, 'postpilot');
});
