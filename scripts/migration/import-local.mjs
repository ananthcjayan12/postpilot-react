import { readFile, stat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { createDecipheriv, createCipheriv, randomBytes, createHash } from 'node:crypto';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { cloudflare } from '../cloudflare/config.mjs';
const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    source: { type: 'string', default: 'apps/api/data' },
    'owner-sub': { type: 'string' },
    'owner-email': { type: 'string' },
    'include-credentials': { type: 'boolean', default: false },
  },
});
const source = await realpath(resolve(values.source));
const db = JSON.parse(await readFile(resolve(source, 'postpilot.json'), 'utf8'));
if (!Array.isArray(db.media) || !Array.isArray(db.posts)) throw new Error('Invalid local database.');
const files = [];
for (const item of db.media) {
  const path = await realpath(resolve(source, 'uploads', item.fileName));
  if (!path.startsWith(`${source}${sep}uploads${sep}`))
    throw new Error('Media path escapes uploads directory.');
  const info = await stat(path);
  if (info.size !== item.size) throw new Error(`Size mismatch for media ${item.id}`);
  files.push({ ...item, path });
}
console.log(
  `Validated ${files.length} media files and ${db.posts.length} posts. Scheduled/publishing posts will be imported as drafts. Credentials: ${values['include-credentials'] ? 'requested' : 'excluded'}.`,
);
if (!values.apply) {
  console.log('Dry run complete. Nothing was uploaded or changed.');
  process.exit(0);
}
const owner = values['owner-sub'],
  email = values['owner-email'];
if (!owner || !email)
  throw new Error('--owner-sub and --owner-email are required. Sign in to the deployed studio first.');
for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'])
  if (!process.env[k]) throw new Error(`Missing ${k}`);
const state = JSON.parse(await readFile('.cloudflare-state.json', 'utf8')),
  cf = cloudflare(process.env);
async function query(sql, params = []) {
  const result = await cf(`/d1/database/${state.databaseId}/query`, {
    method: 'POST',
    body: { sql, params },
  });
  if (!result?.[0]?.success) throw new Error('D1 import query failed.');
  return result[0].results;
}
const users = await query('SELECT id,email FROM users WHERE id=?', [owner]);
if (users.length !== 1 || users[0].email.toLowerCase() !== email.toLowerCase())
  throw new Error('Target owner does not match an existing signed-in user.');
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
let importedMedia = 0,
  importedPosts = 0;
for (const item of files) {
  const existing = await query('SELECT user_id FROM media WHERE id=?', [item.id]);
  if (existing.length) {
    if (existing[0].user_id !== owner) throw new Error(`Ownership conflict: ${item.id}`);
    continue;
  }
  const key = `${owner}/${item.id}`;
  let present = false;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: state.bucket, Key: key }));
    if (head.ContentLength !== item.size) throw new Error(`Existing object mismatch: ${item.id}`);
    present = true;
  } catch (e) {
    if (e.$metadata?.httpStatusCode !== 404) throw e;
  }
  if (!present)
    await new Upload({
      client: s3,
      params: {
        Bucket: state.bucket,
        Key: key,
        Body: createReadStream(item.path),
        ContentType: item.mimeType,
      },
      partSize: 8 * 1024 ** 2,
      queueSize: 2,
      leavePartsOnError: false,
    }).done();
  await query(
    'INSERT OR IGNORE INTO media(id,user_id,object_key,name,mime,size,created_at) VALUES(?,?,?,?,?,?,?)',
    [item.id, owner, key, item.originalName, item.mimeType, item.size, item.createdAt],
  );
  importedMedia++;
}
for (const post of db.posts) {
  const existing = await query('SELECT user_id FROM posts WHERE id=?', [post.id]);
  if (existing.length && existing[0].user_id !== owner) throw new Error(`Ownership conflict: ${post.id}`);
  const active = ['scheduled', 'publishing'].includes(post.status),
    status = active ? 'draft' : post.status;
  await query(
    'INSERT OR IGNORE INTO posts(id,user_id,media_id,title,caption,status,scheduled_for,created_at,updated_at,attempts,last_error) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    [
      post.id,
      owner,
      post.mediaId,
      post.title,
      post.caption,
      status,
      null,
      post.createdAt,
      post.updatedAt,
      post.attempts || 0,
      active ? 'Imported paused. Review the original schedule before publishing.' : post.lastError || null,
    ],
  );
  for (const platform of post.platforms) {
    const r = post.results?.[platform];
    await query('INSERT OR IGNORE INTO targets(post_id,platform,status,data,error) VALUES(?,?,?,?,?)', [
      post.id,
      platform,
      r?.ok ? 'success' : r ? 'failed' : 'pending',
      JSON.stringify(r?.ok ? { id: r.id, url: r.url } : {}),
      r?.error || null,
    ]);
  }
  if (!existing.length) importedPosts++;
}
// Never overwrite current connected accounts. Credential migration is separately opt-in.
if (values['include-credentials']) {
  const oldKey = process.env.OLD_APP_ENCRYPTION_KEY,
    newKey = Buffer.from(process.env.APP_ENCRYPTION_KEY || '', 'base64');
  if (!oldKey || newKey.length !== 32)
    throw new Error('OLD_APP_ENCRYPTION_KEY and a valid APP_ENCRYPTION_KEY are required.');
  const envelope = JSON.parse(await readFile(resolve(source, 'secrets.json'), 'utf8'));
  let key = Buffer.from(oldKey, 'base64');
  if (key.length !== 32) key = createHash('sha256').update(oldKey).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const secrets = JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString(),
  );
  for (const provider of ['google', 'meta']) {
    if (!secrets[provider]) continue;
    if (
      (await query('SELECT provider FROM credentials WHERE user_id=? AND provider=?', [owner, provider]))
        .length
    )
      continue;
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', newKey, iv);
    cipher.setAAD(Buffer.from(`${owner}:${provider}`));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(secrets[provider])),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    await query('INSERT OR IGNORE INTO credentials(user_id,provider,envelope) VALUES(?,?,?)', [
      owner,
      provider,
      JSON.stringify({ v: 1, iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64') }),
    ]);
    for (const platform of provider === 'google' ? ['youtube'] : ['instagram', 'facebook'])
      if (db.accounts?.[platform])
        await query('INSERT OR IGNORE INTO accounts(user_id,platform,data) VALUES(?,?,?)', [
          owner,
          platform,
          JSON.stringify(db.accounts[platform]),
        ]);
  }
}
console.log(
  `Imported ${importedMedia} media records and ${importedPosts} posts. Existing records were preserved. Local files were not changed. Imported schedules require explicit review and activation.`,
);
