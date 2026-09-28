import { localProviderSchema as provider, companionCapabilitiesSchema as capabilities, companionResultSchemas as resultSchemas } from '@postpilot/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from './env';
import type { Context } from 'hono';
import { requireSession, ownerAllowed } from './auth';
import { AppError, hash, random } from './lib';

type Device = { id: string; user_id: string; capabilities: string };
type Job = {
  id: string;
  provider: string;
  task: keyof typeof resultSchemas;
  input: string;
  status: string;
  result: string | null;
  error: string | null;
  lease: string;
  expires_at: number;
};
export const companion = new Hono<AppEnv>();
export async function expireJobs(env: Env) {
  await env.DB.prepare(
    "UPDATE companion_jobs SET status='expired',error='Computer disconnected or generation deadline exceeded.' WHERE status IN ('queued','running') AND (expires_at<=? OR (status='running' AND lease_until<=?))",
  )
    .bind(Date.now(), Date.now())
    .run();
}
async function device(c: Context<AppEnv>): Promise<Device> {
  const token = c.req.header('Authorization')?.replace(/^Bearer /, '');
  if (!token || token.length > 200) throw new AppError('Device authentication required.', 401);
  const row = await c.env.DB.prepare(
    'SELECT d.*,u.email FROM companion_devices d JOIN users u ON u.id=d.user_id WHERE token_hash=? AND revoked=0',
  )
    .bind(await hash(token))
    .first<Device & { email: string }>();
  if (!row || !ownerAllowed(c.env.ALLOWED_OWNER_EMAIL, row.email))
    throw new AppError('Device access revoked. Pair again.', 401);
  return row;
}
companion.post('/pair', async (c) => {
  const value = z
    .object({ code: z.string().min(40).max(100), name: z.string().trim().min(1).max(80) })
    .parse(await c.req.json());
  const pair = await c.env.DB.prepare(
    'DELETE FROM companion_pairs WHERE code_hash=? AND expires_at>? RETURNING user_id',
  )
    .bind(await hash(value.code), Date.now())
    .first<{ user_id: string }>();
  if (!pair) throw new AppError('Pairing code expired or already used.', 400);
  const token = random(),
    id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO companion_devices(id,user_id,token_hash,name,created_at) VALUES(?,?,?,?,?)',
  )
    .bind(id, pair.user_id, await hash(token), value.name, Date.now())
    .run();
  return c.json({ token, id });
});
companion.post('/poll', async (c) => {
  const d = await device(c),
    value = capabilities.parse(await c.req.json());
  await expireJobs(c.env);
  await c.env.DB.prepare('UPDATE companion_devices SET last_seen=?,capabilities=? WHERE id=? AND revoked=0')
    .bind(Date.now(), JSON.stringify(value), d.id)
    .run();
  const ready = Object.entries(value)
    .filter(([, v]) => v.ready)
    .map(([k]) => k);
  if (!ready.length) return c.json({ job: null });
  const lease = random();
  const job = await c.env.DB.prepare(
    `UPDATE companion_jobs SET status='running',lease=?,lease_until=? WHERE id=(SELECT id FROM companion_jobs WHERE device_id=? AND NOT EXISTS (SELECT 1 FROM companion_jobs running WHERE running.device_id=companion_jobs.device_id AND running.status='running') AND status='queued' AND expires_at>? AND provider IN (${ready.map(() => '?').join(',')}) ORDER BY created_at LIMIT 1) AND status='queued' RETURNING *`,
  )
    .bind(lease, Date.now() + 60000, d.id, Date.now(), ...ready)
    .first<Job>();
  return c.json({
    job: job
      ? {
          id: job.id,
          provider: job.provider,
          task: job.task,
          input: JSON.parse(job.input),
          lease,
          expiresAt: job.expires_at,
        }
      : null,
  });
});
companion.post('/jobs/:id/heartbeat', async (c) => {
  const d = await device(c),
    { lease } = z.object({ lease: z.string().max(100) }).parse(await c.req.json());
  const row = await c.env.DB.prepare(
    "UPDATE companion_jobs SET lease_until=? WHERE id=? AND device_id=? AND lease=? AND status='running' AND lease_until>? AND expires_at>? RETURNING id",
  )
    .bind(Date.now() + 60000, c.req.param('id'), d.id, lease, Date.now(), Date.now())
    .first();
  await c.env.DB.prepare('UPDATE companion_devices SET last_seen=? WHERE id=?').bind(Date.now(), d.id).run();
  return c.json({ active: !!row });
});
companion.post('/jobs/:id/complete', async (c) => {
  const d = await device(c),
    value = z
      .object({
        lease: z.string().max(100),
        result: z.unknown().optional(),
        error: z.enum(['generation_failed', 'cancelled']).optional(),
      })
      .parse(await c.req.json());
  await expireJobs(c.env);
  const job = await c.env.DB.prepare('SELECT * FROM companion_jobs WHERE id=? AND device_id=? AND lease=?')
    .bind(c.req.param('id'), d.id, value.lease)
    .first<Job>();
  if (!job) throw new AppError('Job not found.', 404);
  if (['succeeded', 'failed'].includes(job.status)) return c.json({ ok: true });
  if (job.status !== 'running') throw new AppError('Job is no longer active.', 409);
  const result = value.error ? null : JSON.stringify(resultSchemas[job.task].parse(value.result));
  const changed = await c.env.DB.prepare(
    "UPDATE companion_jobs SET status=?,result=?,error=? WHERE id=? AND status='running' AND lease=? AND lease_until>? AND expires_at>? RETURNING id",
  )
    .bind(
      value.error ? 'failed' : 'succeeded',
      result,
      value.error
        ? 'Local generation failed. Check CLI sign-in, model access, and companion diagnostics.'
        : null,
      job.id,
      value.lease,
      Date.now(),
      Date.now(),
    )
    .first();
  if (!changed) throw new AppError('Job is no longer active.', 409);
  return c.json({ ok: true });
});
companion.use('/devices/*', requireSession);
companion.use('/devices', requireSession);
companion.post('/devices/pairing', async (c) => {
  const code = random(),
    user = c.get('user').id;
  await c.env.DB.prepare('DELETE FROM companion_pairs WHERE user_id=? OR expires_at<?')
    .bind(user, Date.now())
    .run();
  await c.env.DB.prepare('INSERT INTO companion_pairs VALUES(?,?,?)')
    .bind(await hash(code), user, Date.now() + 300000)
    .run();
  return c.json({ code, expiresAt: Date.now() + 300000 });
});
companion.get('/devices', async (c) => {
  await expireJobs(c.env);
  const rows = await c.env.DB.prepare(
    'SELECT id,name,last_seen,capabilities FROM companion_devices WHERE user_id=? AND revoked=0 ORDER BY created_at DESC',
  )
    .bind(c.get('user').id)
    .all<any>();
  const jobs = await c.env.DB.prepare(
    "SELECT id,device_id,task,status FROM companion_jobs WHERE user_id=? AND status IN ('queued','running')",
  )
    .bind(c.get('user').id)
    .all();
  return c.json(
    rows.results.map((r) => ({
      ...r,
      online: r.last_seen > Date.now() - 60000,
      capabilities: JSON.parse(r.capabilities),
      jobs: jobs.results.filter((j) => j.device_id === r.id),
    })),
  );
});
companion.delete('/devices/:id', async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE companion_devices SET revoked=1 WHERE id=? AND user_id=?').bind(
      c.req.param('id'),
      c.get('user').id,
    ),
    c.env.DB.prepare(
      "UPDATE companion_jobs SET status='cancelled',error='Device disconnected.' WHERE device_id=? AND user_id=? AND status IN ('queued','running')",
    ).bind(c.req.param('id'), c.get('user').id),
  ]);
  return c.json({ ok: true });
});
companion.use('/requests/*', requireSession);
companion.get('/requests/:id', async (c) => {
  await expireJobs(c.env);
  const job = await c.env.DB.prepare('SELECT * FROM companion_jobs WHERE id=? AND user_id=?')
    .bind(c.req.param('id'), c.get('user').id)
    .first<Job>();
  if (!job) throw new AppError('Job not found.', 404);
  return c.json({
    id: job.id,
    status: job.status,
    result: job.result ? { ...JSON.parse(job.result), provider: job.provider, model: 'local-default' } : null,
    error: job.error,
  });
});
companion.delete('/requests/:id', async (c) => {
  await c.env.DB.prepare(
    "UPDATE companion_jobs SET status='cancelled',error='Generation cancelled.' WHERE id=? AND user_id=? AND status IN ('queued','running')",
  )
    .bind(c.req.param('id'), c.get('user').id)
    .run();
  return c.json({ ok: true });
});
export async function enqueueText(
  env: Env,
  user: string,
  route: string,
  task: keyof typeof resultSchemas,
  input: { title: string; caption: string; feedback?: string; language: string },
  requestKey: string,
) {
  const p = provider.parse(route.split(':')[0]);
  const key = z.string().uuid().parse(requestKey);
  const old = await env.DB.prepare('SELECT id FROM companion_jobs WHERE user_id=? AND request_key=?')
    .bind(user, key)
    .first<{ id: string }>();
  if (old) return { jobId: old.id };
  await expireJobs(env);
  const devices = await env.DB.prepare(
    'SELECT id,capabilities FROM companion_devices WHERE user_id=? AND revoked=0 AND last_seen>? ORDER BY last_seen DESC',
  )
    .bind(user, Date.now() - 60000)
    .all<Device>();
  const d = devices.results.find((d) => JSON.parse(d.capabilities)[p]?.ready);
  if (!d) throw new AppError(`No ready ${p} companion is online. Start the companion on your computer.`, 409);
  const id = crypto.randomUUID(),
    t = Date.now();
  await env.DB.prepare(
    "INSERT INTO companion_jobs(id,user_id,device_id,request_key,provider,task,input,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM companion_jobs WHERE user_id=? AND status IN ('queued','running'))<3 ON CONFLICT(user_id,request_key) DO NOTHING",
  )
    .bind(id, user, d.id, key, p, task, JSON.stringify(input), t, t + 660000, user)
    .run();
  const saved = await env.DB.prepare('SELECT id FROM companion_jobs WHERE user_id=? AND request_key=?')
    .bind(user, key)
    .first<{ id: string }>();
  if (!saved) throw new AppError('Three local jobs are already pending. Wait or cancel a job.', 429);
  return { jobId: saved.id };
}
