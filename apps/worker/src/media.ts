import { Hono } from 'hono';
import { AwsClient } from 'aws4fetch';
import { z } from 'zod';
import { uploadInput, PART_SIZE } from '@postpilot/shared';
import type { AppEnv, Env, MediaRow } from './env';
import { requireSession } from './auth';
import { AppError, now, validMediaSignature } from './lib';
export const media = new Hono<AppEnv>();
media.use('*', requireSession);
type Upload = {
  id: string;
  user_id: string;
  object_key: string;
  upload_id: string;
  name: string;
  mime: string;
  size: number;
  status: string;
  expires_at: number;
};
export function mediaJson(m: MediaRow) {
  return {
    id: m.id,
    originalName: m.name,
    fileName: m.object_key,
    mimeType: m.mime,
    size: m.size,
    createdAt: m.created_at,
    localUrl: `/media-files/${m.id}`,
  };
}
async function ownedUpload(env: Env, id: string, user: string) {
  const u = await env.DB.prepare('SELECT * FROM uploads WHERE id=? AND user_id=?')
    .bind(id, user)
    .first<Upload>();
  if (!u) throw new AppError('Upload not found.', 404);
  if (u.expires_at < Date.now()) throw new AppError('Upload expired; select the file again.', 410);
  return u;
}
export function localUploads(env: Env) {
  return (
    env.LOCAL_UPLOADS === 'true' && ['localhost', '127.0.0.1'].includes(new URL(env.APP_ORIGIN).hostname)
  );
}
media.post('/uploads', async (c) => {
  const v = uploadInput.parse(await c.req.json()),
    id = crypto.randomUUID(),
    user = c.get('user').id,
    key = `${user}/${id}`;
  const quota = Number(c.env.STORAGE_QUOTA_BYTES || 50 * 1024 ** 3);
  // A conditional insert reserves quota in the same SQL operation, including concurrent uploads.
  const multipart = await c.env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType: v.type } });
  const result = await c.env.DB.prepare(
    `INSERT INTO uploads(id,user_id,object_key,upload_id,name,mime,size,expires_at)
    SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(size),0) FROM media WHERE user_id=?)+(SELECT COALESCE(SUM(size),0) FROM uploads WHERE user_id=? AND status IN ('pending','completing') AND expires_at>?) + ? <= ?`,
  )
    .bind(
      id,
      user,
      key,
      multipart.uploadId,
      v.name,
      v.type,
      v.size,
      Date.now() + 86400000,
      user,
      user,
      Date.now(),
      v.size,
      quota,
    )
    .run();
  if (!result.meta.changes) {
    await multipart.abort();
    throw new AppError('Storage quota exceeded.', 413);
  }
  return c.json({ id, partSize: PART_SIZE, parts: Math.ceil(v.size / PART_SIZE) }, 201);
});
media.post('/uploads/:id/parts', async (c) => {
  const u = await ownedUpload(c.env, c.req.param('id'), c.get('user').id);
  if (u.status !== 'pending') throw new AppError('Upload is no longer accepting parts.', 409);
  const { partNumber } = z.object({ partNumber: z.number().int().positive() }).parse(await c.req.json());
  if (partNumber > Math.ceil(u.size / PART_SIZE)) throw new AppError('Invalid part number.');
  if (localUploads(c.env))
    return c.json({ url: `/api/media/uploads/${u.id}/parts/${partNumber}`, local: true });
  if (!c.env.R2_ACCESS_KEY_ID || !c.env.R2_SECRET_ACCESS_KEY || !c.env.R2_ACCOUNT_ID || !c.env.R2_BUCKET_NAME)
    throw new AppError('R2 signing credentials are not configured.', 503);
  const url = new URL(
    `https://${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${c.env.R2_BUCKET_NAME}/${u.object_key}`,
  );
  url.search = new URLSearchParams({
    uploadId: u.upload_id,
    partNumber: String(partNumber),
    'X-Amz-Expires': '900',
  }).toString();
  const client = new AwsClient({
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  const signed = await client.sign(url, { method: 'PUT', aws: { signQuery: true } });
  return c.json({ url: signed.url, local: false });
});
media.put('/uploads/:id/parts/:part', async (c) => {
  if (!localUploads(c.env)) throw new AppError('Not found.', 404);
  const u = await ownedUpload(c.env, c.req.param('id'), c.get('user').id);
  const part = Number(c.req.param('part'));
  if (u.status !== 'pending' || !Number.isInteger(part) || part < 1 || part > Math.ceil(u.size / PART_SIZE))
    throw new AppError('Invalid part.');
  // Local adapter only: bounded 8 MiB parts, never an entire video.
  const body = await c.req.arrayBuffer();
  if (body.byteLength !== Math.min(PART_SIZE, u.size - (part - 1) * PART_SIZE))
    throw new AppError('Incorrect part size.');
  const result = await c.env.MEDIA.resumeMultipartUpload(u.object_key, u.upload_id).uploadPart(part, body);
  return c.json(result);
});
media.post('/uploads/:id/complete', async (c) => {
  const u = await ownedUpload(c.env, c.req.param('id'), c.get('user').id);
  const existing = await c.env.DB.prepare('SELECT * FROM media WHERE id=? AND user_id=?')
    .bind(u.id, u.user_id)
    .first<MediaRow>();
  if (existing) return c.json(mediaJson(existing));
  if (!['pending', 'completing'].includes(u.status)) throw new AppError('Upload is unavailable.', 409);
  const { parts } = z
    .object({
      parts: z
        .array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1).max(200) }))
        .min(1)
        .max(640),
    })
    .parse(await c.req.json());
  parts.sort((a, b) => a.partNumber - b.partNumber);
  if (parts.length !== Math.ceil(u.size / PART_SIZE) || parts.some((p, i) => p.partNumber !== i + 1))
    throw new AppError('Incomplete or duplicate part manifest.');
  await c.env.DB.prepare("UPDATE uploads SET status='completing' WHERE id=? AND status='pending'")
    .bind(u.id)
    .run();
  let object = await c.env.MEDIA.head(u.object_key);
  if (!object) {
    try {
      await c.env.MEDIA.resumeMultipartUpload(u.object_key, u.upload_id).complete(parts);
    } catch {
      object = await c.env.MEDIA.head(u.object_key);
      if (!object) throw new AppError('Completion failed; retry with the same manifest.', 409);
    }
    object = await c.env.MEDIA.head(u.object_key);
  }
  if (!object || object.size !== u.size || object.httpMetadata?.contentType !== u.mime) {
    await c.env.MEDIA.delete(u.object_key);
    await c.env.DB.prepare("UPDATE uploads SET status='invalid' WHERE id=?").bind(u.id).run();
    throw new AppError('Uploaded object does not match its declared size/type.');
  }
  const created = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT OR IGNORE INTO media(id,user_id,object_key,name,mime,size,created_at) VALUES(?,?,?,?,?,?,?)',
    ).bind(u.id, u.user_id, u.object_key, u.name, u.mime, u.size, created),
    c.env.DB.prepare("UPDATE uploads SET status='complete' WHERE id=?").bind(u.id),
  ]);
  return c.json(
    mediaJson((await c.env.DB.prepare('SELECT * FROM media WHERE id=?').bind(u.id).first<MediaRow>())!),
    201,
  );
});
media.post('/uploads/:id/abort', async (c) => {
  const u = await ownedUpload(c.env, c.req.param('id'), c.get('user').id);
  const claimed = await c.env.DB.prepare(
    "UPDATE uploads SET status='aborting' WHERE id=? AND status IN ('pending','aborting') RETURNING id",
  )
    .bind(u.id)
    .first();
  if (!claimed) throw new AppError('Cannot abort a completing or completed upload.', 409);
  await c.env.MEDIA.resumeMultipartUpload(u.object_key, u.upload_id).abort();
  await c.env.DB.prepare("UPDATE uploads SET status='aborted' WHERE id=?").bind(u.id).run();
  return c.json({ ok: true });
});
media.get('/', async (c) =>
  c.json(
    (
      await c.env.DB.prepare('SELECT * FROM media WHERE user_id=? ORDER BY created_at DESC')
        .bind(c.get('user').id)
        .all<MediaRow>()
    ).results.map(mediaJson),
  ),
);
media.get('/:id', async (c) => {
  const m = await c.env.DB.prepare('SELECT * FROM media WHERE id=? AND user_id=?')
    .bind(c.req.param('id'), c.get('user').id)
    .first<MediaRow>();
  if (!m) throw new AppError('Media not found.', 404);
  return c.json(mediaJson(m));
});
export async function mediaResponse(request: Request, env: Env, id: string, user?: string) {
  const url = new URL(request.url);
  if (
    !user &&
    !(await validMediaSignature(
      env,
      id,
      Number(url.searchParams.get('expires')),
      url.searchParams.get('signature') || '',
    ))
  )
    throw new AppError('Invalid or expired media link.', 403);
  const row = await env.DB.prepare(
    user ? 'SELECT * FROM media WHERE id=? AND user_id=?' : 'SELECT * FROM media WHERE id=?',
  )
    .bind(...(user ? [id, user] : [id]))
    .first<MediaRow>();
  if (!row) throw new AppError('Media not found.', 404);
  if (
    !['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'].includes(
      row.mime,
    )
  )
    throw new AppError('Unsupported media type.', 415);
  const head = await env.MEDIA.head(row.object_key);
  if (!head) throw new AppError('Media not found.', 404);
  const headers = new Headers({
    'Content-Type': row.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  });
  headers.set('ETag', head.httpEtag);
  let offset = 0,
    length = head.size,
    status = 200;
  const range = request.headers.get('Range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${head.size}` } });
    if (!match[1]) {
      length = Math.min(Number(match[2]), head.size);
      offset = head.size - length;
    } else {
      offset = Number(match[1]);
      length = Math.min(match[2] ? Number(match[2]) : head.size - 1, head.size - 1) - offset + 1;
    }
    if (offset >= head.size || length <= 0)
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${head.size}` } });
    status = 206;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${head.size}`);
  }
  headers.set('Content-Length', String(length));
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const object = await env.MEDIA.get(row.object_key, { range: { offset, length } });
  if (!object) throw new AppError('Media not found.', 404);
  return new Response(object.body, { status, headers });
}
export async function cleanupUploads(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT * FROM uploads WHERE expires_at<? AND status IN ('pending','completing','aborting') LIMIT 20",
  )
    .bind(Date.now())
    .all<Upload>();
  for (const u of rows.results) {
    try {
      await env.MEDIA.resumeMultipartUpload(u.object_key, u.upload_id).abort();
      const exists = await env.DB.prepare('SELECT id FROM media WHERE id=?').bind(u.id).first();
      if (!exists) await env.MEDIA.delete(u.object_key);
      await env.DB.prepare("UPDATE uploads SET status='expired' WHERE id=?").bind(u.id).run();
    } catch {
      console.warn('Upload cleanup will retry', u.id);
    }
  }
}
