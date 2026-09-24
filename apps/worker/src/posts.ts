import { Hono } from 'hono';
import { z } from 'zod';
import { postInput, settingsInput, defaultSettings, shortsEligibility } from '@postpilot/shared';
import type { AppEnv, Env, PostRow, Target } from './env';
import { AppError, getCredential, now, saveCredential } from './lib';
import { requireSession } from './auth';
export const api = new Hono<AppEnv>();
api.use('*', requireSession);
export async function postJson(env: Env, p: PostRow, suppliedTargets?: Target[]) {
  const targets =
    suppliedTargets ||
    (await env.DB.prepare('SELECT * FROM targets WHERE post_id=?').bind(p.id).all<Target>()).results;
  const youtubeTarget = targets.find((target) => target.platform === 'youtube');
  const youtubeData = youtubeTarget ? JSON.parse(youtubeTarget.data) : {};
  return {
    id: p.id,
    title: p.title,
    caption: p.caption,
    mediaId: p.media_id,
    platforms: targets.map((t) => t.platform),
    status: p.status,
    scheduledFor: p.scheduled_for || undefined,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    attempts: p.attempts,
    lastError: p.last_error || undefined,
    results: Object.fromEntries(
      targets
        .filter((t) => ['success', 'failed', 'review'].includes(t.status))
        .map((t) => {
          const d = JSON.parse(t.data);
          return [
            t.platform,
            { ok: t.status === 'success', id: d.id, url: d.url, error: t.error || undefined },
          ];
        }),
    ),
    youtubeFormat: youtubeData.youtubeFormat || 'video',
  };
}
api.get('/posts', async (c) => {
  const user = c.get('user').id;
  const posts = (
    await c.env.DB.prepare('SELECT * FROM posts WHERE user_id=? ORDER BY created_at DESC')
      .bind(user)
      .all<PostRow>()
  ).results;
  const targets = (
    await c.env.DB.prepare('SELECT t.* FROM targets t JOIN posts p ON p.id=t.post_id WHERE p.user_id=?')
      .bind(user)
      .all<Target>()
  ).results;
  const grouped = new Map<string, Target[]>();
  for (const t of targets) grouped.set(t.post_id, [...(grouped.get(t.post_id) || []), t]);
  return c.json(await Promise.all(posts.map((p) => postJson(c.env, p, grouped.get(p.id) || []))));
});
api.post('/posts', async (c) => {
  const v = postInput.parse(await c.req.json()),
    user = c.get('user').id;
  const media = await c.env.DB.prepare('SELECT id,mime FROM media WHERE id=? AND user_id=?')
    .bind(v.mediaId, user)
    .first<{ id: string; mime: string }>();
  if (!media) throw new AppError('Select an uploaded media asset.');
  if (v.platforms.includes('youtube') && v.youtubeFormat === 'short') {
    if (!media.mime.startsWith('video/')) throw new AppError('YouTube Shorts require a video.');
    const error = shortsEligibility(v.videoMetadata);
    if (error) throw new AppError(error);
  }
  if (v.action === 'schedule' && (!v.scheduledFor || Date.parse(v.scheduledFor) <= Date.now()))
    throw new AppError('Choose a future schedule time.');
  const id = crypto.randomUUID(),
    time = now(),
    status = v.action === 'draft' ? 'draft' : v.action === 'schedule' ? 'scheduled' : 'publishing';
  const statements = [
    c.env.DB.prepare(
      'INSERT INTO posts(id,user_id,media_id,title,caption,status,scheduled_for,created_at,updated_at,attempts) VALUES(?,?,?,?,?,?,?,?,?,?)',
    ).bind(
      id,
      user,
      v.mediaId,
      v.title,
      v.caption,
      status,
      v.action === 'schedule' ? v.scheduledFor! : null,
      time,
      time,
      v.action === 'publish' ? 1 : 0,
    ),
    ...v.platforms.map((p) =>
      c.env.DB.prepare('INSERT INTO targets(post_id,platform,data) VALUES(?,?,?)').bind(
        id,
        p,
        JSON.stringify(p === 'youtube' ? { youtubeFormat: v.youtubeFormat } : {}),
      ),
    ),
  ];
  if (v.action === 'publish')
    statements.push(
      c.env.DB.prepare('INSERT INTO runs(id,post_id,created_at) VALUES(?,?,?)').bind(
        crypto.randomUUID(),
        id,
        time,
      ),
    );
  await c.env.DB.batch(statements);
  if (v.action === 'publish') c.executionCtx.waitUntil(dispatch(c.env));
  return c.json(
    await postJson(
      c.env,
      (await c.env.DB.prepare('SELECT * FROM posts WHERE id=?').bind(id).first<PostRow>())!,
    ),
    201,
  );
});
api.put('/posts/:id', async (c) => {
  const v = postInput.parse(await c.req.json());
  if (v.action === 'publish') throw new AppError('Save the project before publishing it.', 400);
  const id = c.req.param('id'),
    user = c.get('user').id;
  const post = await c.env.DB.prepare('SELECT * FROM posts WHERE id=? AND user_id=?')
    .bind(id, user)
    .first<PostRow>();
  if (!post) throw new AppError('Post not found.', 404);
  if (!['draft', 'scheduled'].includes(post.status))
    throw new AppError('Only draft or scheduled projects can be edited.', 409);
  const active = await c.env.DB.prepare(
    "SELECT id FROM runs WHERE post_id=? AND status IN ('pending','dispatched')",
  )
    .bind(id)
    .first();
  if (active) throw new AppError('This project is currently publishing and cannot be edited.', 409);
  const media = await c.env.DB.prepare('SELECT id,mime FROM media WHERE id=? AND user_id=?')
    .bind(v.mediaId, user)
    .first<{ id: string; mime: string }>();
  if (!media) throw new AppError('Select an uploaded media asset.');
  if (v.platforms.includes('youtube') && v.youtubeFormat === 'short') {
    if (!media.mime.startsWith('video/')) throw new AppError('YouTube Shorts require a video.');
    const error = shortsEligibility(v.videoMetadata);
    if (error) throw new AppError(error);
  }
  if (v.action === 'schedule' && (!v.scheduledFor || Date.parse(v.scheduledFor) <= Date.now()))
    throw new AppError('Choose a future schedule time.');
  const time = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE posts SET media_id=?,title=?,caption=?,status=?,scheduled_for=?,updated_at=?,last_error=NULL WHERE id=? AND user_id=?',
    ).bind(
      v.mediaId,
      v.title,
      v.caption,
      v.action === 'schedule' ? 'scheduled' : 'draft',
      v.action === 'schedule' ? v.scheduledFor! : null,
      time,
      id,
      user,
    ),
    c.env.DB.prepare('DELETE FROM targets WHERE post_id=?').bind(id),
    ...v.platforms.map((platform) =>
      c.env.DB.prepare('INSERT INTO targets(post_id,platform,data) VALUES(?,?,?)').bind(
        id,
        platform,
        JSON.stringify(platform === 'youtube' ? { youtubeFormat: v.youtubeFormat } : {}),
      ),
    ),
  ]);
  return c.json(
    await postJson(
      c.env,
      (await c.env.DB.prepare('SELECT * FROM posts WHERE id=?').bind(id).first<PostRow>())!,
    ),
  );
});
api.post('/posts/:id/:action', async (c) => {
  if (!['publish', 'retry'].includes(c.req.param('action'))) throw new AppError('Not found.', 404);
  const id = c.req.param('id'),
    user = c.get('user').id;
  const post = await c.env.DB.prepare('SELECT * FROM posts WHERE id=? AND user_id=?')
    .bind(id, user)
    .first<PostRow>();
  if (!post) throw new AppError('Post not found.', 404);
  const uncertain = await c.env.DB.prepare("SELECT platform FROM targets WHERE post_id=? AND status='review'")
    .bind(id)
    .first();
  if (uncertain)
    throw new AppError(
      'A provider outcome needs review. Verify the remote account before taking further action.',
      409,
    );
  if (!['published', 'publishing'].includes(post.status)) {
    const runId = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO runs(id,post_id,created_at) SELECT ?,id,? FROM posts WHERE id=? AND user_id=? AND status NOT IN ('published','publishing') AND NOT EXISTS(SELECT 1 FROM runs WHERE post_id=? AND status IN ('pending','dispatched'))",
      ).bind(runId, now(), id, user, id),
      c.env.DB.prepare(
        "UPDATE posts SET status='publishing',last_error=NULL,attempts=attempts+1,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM runs WHERE id=?)",
      ).bind(now(), id, runId),
      c.env.DB.prepare(
        "UPDATE targets SET status='pending',error=NULL,data=CASE WHEN platform='instagram' THEN '{}' ELSE data END WHERE post_id=? AND status='failed' AND EXISTS(SELECT 1 FROM runs WHERE id=?)",
      ).bind(id, runId),
    ]);
    c.executionCtx.waitUntil(dispatch(c.env));
  }
  return c.json(
    await postJson(
      c.env,
      (await c.env.DB.prepare('SELECT * FROM posts WHERE id=?').bind(id).first<PostRow>())!,
    ),
  );
});
api.post('/posts/:id/targets/:platform/resolve', async (c) => {
  const { outcome, remoteId, confirmation } = z
    .object({
      outcome: z.enum(['published', 'not_published']),
      remoteId: z.string().max(200).optional(),
      confirmation: z.literal('I checked the provider account'),
    })
    .parse(await c.req.json());
  const id = c.req.param('id'),
    platform = c.req.param('platform'),
    user = c.get('user').id;
  const post = await c.env.DB.prepare('SELECT id FROM posts WHERE id=? AND user_id=?').bind(id, user).first();
  if (!post) throw new AppError('Post not found.', 404);
  if (outcome === 'published' && !remoteId)
    throw new AppError('Enter the provider post/video ID to confirm publication.');
  const active = await c.env.DB.prepare(
    "SELECT id FROM runs WHERE post_id=? AND status IN ('pending','dispatched')",
  )
    .bind(id)
    .first();
  if (active) throw new AppError('Wait for the current publishing run to finish.', 409);
  const changed = await c.env.DB.prepare(
    "UPDATE targets SET status=?,data=?,error=? WHERE post_id=? AND platform=? AND status='review'",
  )
    .bind(
      outcome === 'published' ? 'success' : 'failed',
      JSON.stringify(
        outcome === 'published'
          ? { id: remoteId, manuallyVerified: true, verifiedAt: now() }
          : { manuallyVerifiedAbsent: true },
      ),
      outcome === 'published' ? null : 'Owner verified not published; ready to retry.',
      id,
      platform,
    )
    .run();
  if (!changed.meta.changes) throw new AppError('This target does not need review.', 409);
  await c.env.DB.prepare(
    "UPDATE posts SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM targets WHERE post_id=? AND status!='success') THEN 'published' WHEN EXISTS(SELECT 1 FROM targets WHERE post_id=? AND status='success') THEN 'partial' ELSE 'failed' END,last_error=NULL,updated_at=? WHERE id=?",
  )
    .bind(id, id, now(), id)
    .run();
  return c.json({ ok: true, confirmation });
});
api.get('/accounts', async (c) => {
  const user = c.get('user').id,
    rows = (
      await c.env.DB.prepare('SELECT platform,data FROM accounts WHERE user_id=?')
        .bind(user)
        .all<{ platform: string; data: string }>()
    ).results;
  const accounts: any = Object.fromEntries(
    ['youtube', 'instagram', 'facebook'].map((p) => [p, { platform: p, connected: false }]),
  );
  for (const row of rows) accounts[row.platform] = JSON.parse(row.data);

  const providers = new Set(
    (
      await c.env.DB.prepare('SELECT provider FROM credentials WHERE user_id=?')
        .bind(user)
        .all<{ provider: string }>()
    ).results.map((row) => row.provider),
  );
  if (!providers.has('instagram')) {
    accounts.instagram = {
      platform: 'instagram',
      connected: false,
      detail: rows.some((row) => row.platform === 'instagram')
        ? 'Reconnect Instagram using direct Instagram Login.'
        : undefined,
    };
  }
  if (!providers.has('facebook') && !providers.has('meta')) {
    accounts.facebook = { platform: 'facebook', connected: false };
  }

  return c.json({
    accounts,
    readiness: {
      googleConfigured: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
      facebookConfigured: !!(
        (c.env.FACEBOOK_APP_ID || c.env.META_APP_ID) &&
        (c.env.FACEBOOK_APP_SECRET || c.env.META_APP_SECRET)
      ),
      instagramConfigured: !!(c.env.INSTAGRAM_APP_ID && c.env.INSTAGRAM_APP_SECRET),
      publicMediaUrlConfigured: c.env.APP_ORIGIN.startsWith('https://'),
      publicBaseUrl: c.env.APP_ORIGIN,
    },
  });
});
api.get('/analytics', async (c) => {
  const user = c.get('user').id;
  const counts: any = { draft: 0, scheduled: 0, publishing: 0, published: 0, partial: 0, failed: 0 };
  for (const r of (
    await c.env.DB.prepare('SELECT status,COUNT(*) AS n FROM posts WHERE user_id=? GROUP BY status')
      .bind(user)
      .all<{ status: string; n: number }>()
  ).results)
    counts[r.status] = r.n;
  const platforms: any = { youtube: 0, instagram: 0, facebook: 0 };
  for (const r of (
    await c.env.DB.prepare(
      'SELECT t.platform,COUNT(*) AS n FROM targets t JOIN posts p ON p.id=t.post_id WHERE p.user_id=? GROUP BY t.platform',
    )
      .bind(user)
      .all<{ platform: string; n: number }>()
  ).results)
    platforms[r.platform] = r.n;
  const recent = (
    await c.env.DB.prepare(
      "SELECT substr(created_at,1,10) AS date,SUM(status='published') AS published,SUM(status='scheduled') AS scheduled FROM posts WHERE user_id=? GROUP BY date ORDER BY date DESC LIMIT 14",
    )
      .bind(user)
      .all()
  ).results.reverse();
  return c.json({
    total: Object.values(counts).reduce((a: any, b: any) => a + b, 0),
    counts,
    platforms,
    recent,
  });
});
api.get('/settings', async (c) => {
  const row = await c.env.DB.prepare('SELECT data FROM settings WHERE user_id=?')
    .bind(c.get('user').id)
    .first<{ data: string }>();
  const geminiConfigured = !!(await getCredential(c.env, c.get('user').id, 'gemini'));
  return c.json({ ...(row ? { ...defaultSettings, ...JSON.parse(row.data) } : defaultSettings), geminiConfigured });
});
api.put('/settings', async (c) => {
  const value = settingsInput.parse(await c.req.json());
  const { geminiApiKey, ...preferences } = value;
  if (geminiApiKey) await saveCredential(c.env, c.get('user').id, 'gemini', { apiKey: geminiApiKey });
  if (geminiApiKey === null) await c.env.DB.prepare('DELETE FROM credentials WHERE user_id=? AND provider=?').bind(c.get('user').id, 'gemini').run();
  await c.env.DB.prepare(
    'INSERT INTO settings(user_id,data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',
  )
    .bind(c.get('user').id, JSON.stringify(preferences))
    .run();
  return c.json({ ...preferences, geminiConfigured: geminiApiKey ? true : !!(await getCredential(c.env, c.get('user').id, 'gemini')) });
});
export async function dispatch(env: Env) {
  const due = (
    await env.DB.prepare(
      "SELECT p.id FROM posts p LEFT JOIN settings s ON s.user_id=p.user_id WHERE p.status='scheduled' AND p.scheduled_for<=? AND COALESCE(json_extract(s.data,'$.schedulerEnabled'),1)=1 ORDER BY p.scheduled_for LIMIT 20",
    )
      .bind(now())
      .all<{ id: string }>()
  ).results;
  for (const p of due) {
    const runId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO runs(id,post_id,created_at) SELECT ?,id,? FROM posts WHERE id=? AND status='scheduled' AND NOT EXISTS(SELECT 1 FROM runs WHERE post_id=? AND status IN ('pending','dispatched'))",
      ).bind(runId, now(), p.id, p.id),
      env.DB.prepare(
        "UPDATE posts SET status='publishing',attempts=attempts+1,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM runs WHERE id=?)",
      ).bind(now(), p.id, runId),
    ]);
  }
  const pending = (
    await env.DB.prepare("SELECT id FROM runs WHERE status='pending' ORDER BY created_at LIMIT 20").all<{
      id: string;
    }>()
  ).results;
  for (const run of pending) {
    // createBatch is idempotent for retained IDs; D1 retains the permanent dispatch record.
    try {
      await env.PUBLISH.createBatch([{ id: run.id, params: { runId: run.id } }]);
      await env.DB.prepare(
        "UPDATE runs SET status='dispatched',dispatched_at=? WHERE id=? AND status='pending'",
      )
        .bind(now(), run.id)
        .run();
    } catch {
      console.warn('Publishing dispatch will retry', run.id);
    }
  }
  const active = (
    await env.DB.prepare(
      "SELECT id,post_id FROM runs WHERE status='dispatched' ORDER BY dispatched_at LIMIT 20",
    ).all<{ id: string; post_id: string }>()
  ).results;
  for (const r of active) {
    try {
      const instance = await env.PUBLISH.get(r.id);
      const state = await instance.status();
      if (['errored', 'terminated'].includes(state.status))
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE targets SET status='review',error='Publishing execution stopped; verify remote results before retrying.' WHERE post_id=? AND status NOT IN ('success','failed','review')",
          ).bind(r.post_id),
          env.DB.prepare(
            "UPDATE posts SET status=CASE WHEN EXISTS(SELECT 1 FROM targets WHERE post_id=? AND status='success') THEN 'partial' ELSE 'failed' END,last_error='Publishing execution stopped; review provider outcomes.',updated_at=? WHERE id=?",
          ).bind(r.post_id, now(), r.post_id),
          env.DB.prepare("UPDATE runs SET status='failed',finished_at=? WHERE id=?").bind(now(), r.id),
        ]);
    } catch {
      console.warn('Workflow reconciliation will retry', r.id);
    }
  }
}
