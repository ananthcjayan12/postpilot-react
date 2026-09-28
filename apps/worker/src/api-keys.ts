import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from './env';
import { requireSession } from './auth';
import { AppError, hash, now, random } from './lib';

export const apiKeys = new Hono<AppEnv>();
apiKeys.use('*', requireSession);
apiKeys.get('/', async (c) => c.json((await c.env.DB.prepare(
  'SELECT id,name,prefix,created_at AS createdAt,last_used_at AS lastUsedAt FROM api_keys WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at DESC',
).bind(c.get('user').id).all()).results));
apiKeys.post('/', async (c) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await c.req.json());
  const id = crypto.randomUUID(), token = `ppk_${random()}`, createdAt = now();
  await c.env.DB.prepare('INSERT INTO api_keys(id,user_id,name,token_hash,prefix,created_at) VALUES(?,?,?,?,?,?)')
    .bind(id, c.get('user').id, name, await hash(token), token.slice(0, 12), createdAt).run();
  return c.json({ id, name, prefix: token.slice(0, 12), createdAt, token }, 201);
});
apiKeys.delete('/:id', async (c) => {
  const result = await c.env.DB.prepare('UPDATE api_keys SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL')
    .bind(now(), c.req.param('id'), c.get('user').id).run();
  if (!result.meta.changes) throw new AppError('API key not found.', 404);
  return c.json({ ok: true });
});
