import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provision } from './provision.mjs';

test('full bootstrap parses JSONC, wires bindings, and reuses existing resources', async () => {
  const cwd = process.cwd();
  const base = await readFile(join(cwd, 'wrangler.jsonc'), 'utf8');
  const directory = await mkdtemp(join(tmpdir(), 'postpilot-provision-test-'));
  const originalFetch = globalThis.fetch;
  let database = null, bucket = null, creations = 0;
  const policies = {};
  try {
    await writeFile(join(directory, 'wrangler.jsonc'), base);
    process.chdir(directory);
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname.replace(/^\/client\/v4\/accounts\/[^/]+/, '');
      let result = null;
      if (path === '/d1/database' && init.method === 'GET') result = database ? [database] : [];
      else if (path === '/d1/database' && init.method === 'POST') { result = database = {name:'postpilot-db',uuid:'test-database-id'}; creations++; }
      else if (path === '/r2/buckets/postpilot-media') {
        if (!bucket) return Response.json({success:false}, {status:404});
        result = bucket;
      } else if (path === '/r2/buckets' && init.method === 'POST') {result = bucket = {name:'postpilot-media'};creations++;}
      else if (path.endsWith('/domains/managed')) result = {enabled:false};
      else if (path.endsWith('/domains/custom')) result = {domains:[]};
      else if (path === '/workers/subdomain') result = {subdomain:'test-account'};
      else if (path.endsWith('/cors') || path.endsWith('/lifecycle')) {
        if (init.method === 'PUT') policies[path] = JSON.parse(init.body);
        result = policies[path] || {rules:[{id:'unrelated-rule'}]};
      } else throw new Error(`Unexpected provisioning call: ${init.method} ${path}`);
      return Response.json({success:true,result});
    };
    const env = {CLOUDFLARE_API_TOKEN:'test-token',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),APP_ENCRYPTION_KEY:Buffer.alloc(32).toString('base64'),ALLOWED_OWNER_EMAIL:'owner@example.com'};
    const first = await provision(env);
    assert.equal(first.databaseCreated,true);
    assert.equal(first.bucketCreated,true);
    const config = JSON.parse(await readFile('wrangler.generated.json','utf8'));
    assert.equal(config.d1_databases[0].database_id,'test-database-id');
    assert.equal(config.vars.APP_ORIGIN,'https://postpilot.test-account.workers.dev');
    assert.equal(config.vars.LOCAL_UPLOADS,'false');
    assert.equal(config.vars.APP_ENCRYPTION_KEY,undefined);
    assert.equal(config.vars.CLOUDFLARE_API_TOKEN,undefined);
    const second = await provision(env);
    assert.equal(second.databaseCreated,false);
    assert.equal(second.bucketCreated,false);
    assert.equal(creations,2);
    for (const policy of Object.values(policies)) assert.equal(policy.rules.length,2);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(cwd);
    await rm(directory,{recursive:true,force:true});
  }
});
