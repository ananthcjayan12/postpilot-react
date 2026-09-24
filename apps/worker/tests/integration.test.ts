import {
  env,
  applyD1Migrations,
  createExecutionContext,
  waitOnExecutionContext,
  introspectWorkflowInstance,
} from 'cloudflare:test';
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { app } from '../src/index';
import { uploadVideo } from '../src/gemini';
import { hash, seal, unseal, signMedia, validMediaSignature, now, saveCredential } from '../src/lib';
import { ownerAllowed } from '../src/auth';
import { dispatch } from '../src/posts';
import { confirmedOffset, youtubeChunk, publishFacebook, publishInstagram } from '../src/publish';
import type { Env, PostRow, MediaRow } from '../src/env';
const e = env as unknown as Env & { TEST_MIGRATIONS: any };
const token = 'test-owner-session',
  csrf = 'test-csrf';
const user = 'owner-sub';
let pending: { url: string; method: string; result: unknown; status: number }[] = [];
function mockProvider(url: string, result: unknown, method = 'GET', status = 200) {
  pending.push({ url, result, method, status });
}
beforeAll(async () => {
  await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);
});
beforeEach(async () => {
  for (const table of [
    'attempts',
    'runs',
    'targets',
    'posts',
    'uploads',
    'media',
    'credentials',
    'accounts',
    'settings',
    'oauth_states',
    'sessions',
    'users',
  ])
    await e.DB.prepare(`DELETE FROM ${table}`).run();
  await e.DB.prepare('INSERT INTO users VALUES(?,?,?,?)')
    .bind(user, 'owner@example.com', 'Owner', now())
    .run();
  await e.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)')
    .bind(await hash(token), user, csrf, Date.now() + 3600000)
    .run();
  pending = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any) => {
    const url = typeof input === 'string' ? input : input.url || String(input);
    const method = init?.method || 'GET';
    const i = pending.findIndex((x) => x.url === url && x.method === method);
    if (i < 0) throw new Error(`Unexpected provider request: ${new URL(url).origin} ${method}`);
    const [match] = pending.splice(i, 1);
    return new Response(JSON.stringify(match.result), {
      status: match.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  expect(pending).toHaveLength(0);
});
async function call(
  path: string,
  method = 'GET',
  body?: unknown,
  authenticated = true,
  extra: Record<string, string> = {},
) {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: e.APP_ORIGIN,
    ...(authenticated ? { Cookie: `pp_session=${token}`, 'X-CSRF-Token': csrf } : {}),
    ...extra,
  };
  const response = await app.fetch(
    new Request(`${e.APP_ORIGIN}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    e,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}
async function seed(platform = 'youtube') {
  const id = crypto.randomUUID(),
    mid = crypto.randomUUID();
  await e.MEDIA.put(mid, new Uint8Array([1, 2, 3, 4]), { httpMetadata: { contentType: 'video/mp4' } });
  await e.DB.prepare('INSERT INTO media VALUES(?,?,?,?,?,?,?)')
    .bind(mid, user, mid, 'test.mp4', 'video/mp4', 4, now())
    .run();
  await e.DB.prepare(
    'INSERT INTO posts(id,user_id,media_id,title,caption,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
  )
    .bind(id, user, mid, 'Test', 'Caption', 'draft', now(), now())
    .run();
  await e.DB.prepare('INSERT INTO targets(post_id,platform) VALUES(?,?)').bind(id, platform).run();
  return {
    post: (await e.DB.prepare('SELECT * FROM posts WHERE id=?').bind(id).first<PostRow>())!,
    media: (await e.DB.prepare('SELECT * FROM media WHERE id=?').bind(mid).first<MediaRow>())!,
  };
}
describe('session and API boundaries', () => {
  it('transfers a video in bounded chunks with exact bytes and finalizes only the last chunk', async () => {
    const { media } = await seed();
    const chunkSize = 8 * 1024 ** 2;
    const data = new Uint8Array(chunkSize + 17);
    data.fill(5, 0, chunkSize); data.fill(9, chunkSize);
    await e.MEDIA.put(media.object_key, data);
    const chunks: { offset: string; command: string; size: number }[] = [];
    vi.mocked(fetch).mockImplementation(async (url: any, init: any) => {
      if (String(url).endsWith('/upload/v1beta/files')) return new Response('{}', { headers: { 'X-Goog-Upload-URL': 'https://generativelanguage.googleapis.com/upload/session', 'X-Goog-Upload-Chunk-Granularity': '262144' } });
      expect(init.body).toBeInstanceOf(ArrayBuffer);
      const bytes = new Uint8Array(init.body);
      chunks.push({ offset: init.headers['X-Goog-Upload-Offset'], command: init.headers['X-Goog-Upload-Command'], size: bytes.length });
      expect(bytes.every((byte) => byte === (chunks.length === 1 ? 5 : 9))).toBe(true);
      return chunks.length === 1 ? new Response('') : Response.json({ file: { name: 'files/testvideo', state: 'ACTIVE' } });
    });
    expect((await uploadVideo(e, { ...media, size: data.length }, 'test-key')).name).toBe('files/testvideo');
    expect(chunks).toEqual([
      { offset: '0', command: 'upload', size: chunkSize },
      { offset: String(chunkSize), command: 'upload, finalize', size: 17 },
    ]);
  });
  it('preserves a redacted network failure instead of incorrectly calling it a timeout', async () => {
    const { media } = await seed();
    const key = 'test-key';
    const uploadUrl = 'https://generativelanguage.googleapis.com/upload/session?token=secret';
    vi.mocked(fetch).mockImplementation(async (url: any) => {
      if (String(url).endsWith('/upload/v1beta/files')) return new Response('{}', { headers: { 'X-Goog-Upload-URL': uploadUrl } });
      throw new TypeError(`Connection reset for ${uploadUrl} key ${key}`);
    });
    const error = await uploadVideo(e, media, key).catch((error) => error);
    expect(error.message).toContain('connection failed at byte 0 of 4');
    expect(error.message).toContain('Connection reset');
    expect(error.message).not.toContain(key);
    expect(error.message).not.toContain('token=secret');
    expect(error.message).not.toContain('timed out');
  });
  it('encrypts the Gemini key, preserves it on ordinary saves, and removes it explicitly', async () => {
    const preferences = { youtube: true, instagram: false, facebook: false, notify: true, confirm: true, schedulerEnabled: true };
    const key = 'test-gemini-secret-key';
    const saved = await call('/api/settings', 'PUT', { ...preferences, geminiApiKey: key });
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain(key);
    const row: any = await e.DB.prepare("SELECT envelope FROM credentials WHERE user_id=? AND provider='gemini'").bind(user).first();
    expect(row.envelope).not.toContain(key);
    expect((await unseal(e, row.envelope, `${user}:gemini`)).apiKey).toBe(key);
    await call('/api/settings', 'PUT', preferences);
    expect((await (await call('/api/settings')).json() as any).geminiConfigured).toBe(true);
    const settings: any = await e.DB.prepare('SELECT data FROM settings WHERE user_id=?').bind(user).first();
    expect(settings.data).not.toContain(key);
    await call('/api/settings', 'PUT', { ...preferences, geminiApiKey: null });
    expect((await (await call('/api/settings')).json() as any).geminiConfigured).toBe(false);
  });
  it('requires a saved key and rejects media not owned by the caller', async () => {
    const { media } = await seed();
    expect((await call('/api/ai/suggest', 'POST', { mediaId: media.id })).status).toBe(400);
    expect((await call('/api/ai/suggest', 'POST', { mediaId: crypto.randomUUID() })).status).toBe(400);
    expect((await call('/api/ai/suggest', 'POST', { mediaId: media.id }, false)).status).toBe(401);
  });
  it('uploads video, polls processing, generates validated suggestions and deletes the temporary file', async () => {
    const { media } = await seed();
    await saveCredential(e, user, 'gemini', { apiKey: 'test-gemini-secret' });
    const suggestions = { titles: ['One', 'Two', 'Three', 'Four', 'Five'], description: 'Video description' };
    const calls: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input: any, init: any) => {
      const url = String(input); calls.push(`${init?.method || 'GET'} ${url}`);
      if (url.endsWith('/upload/v1beta/files')) return new Response('{}', { headers: { 'X-Goog-Upload-URL': 'https://generativelanguage.googleapis.com/upload/session' } });
      if (url.endsWith('/upload/session')) {
        const headers = new Headers(init.headers);
        expect(headers.get('Content-Length')).toBe(String(media.size));
        expect(headers.get('Content-Type')).toBe('video/mp4');
        expect(headers.get('x-goog-api-key')).toBe('test-gemini-secret');
        expect(new Uint8Array(await new Response(init.body).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
        return Response.json({ file: { name: 'files/testvideo', state: 'PROCESSING' } });
      }
      if (init?.method === 'DELETE') return Response.json({});
      if (url.endsWith('/files/testvideo')) return Response.json({ name: 'files/testvideo', state: 'ACTIVE', uri: 'https://generativelanguage.googleapis.com/v1beta/files/testvideo', mimeType: 'video/mp4' });
      expect(JSON.parse(init.body).contents[0].parts[0].fileData.mimeType).toBe('video/mp4');
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(suggestions) }] } }] });
    });
    const response = await call('/api/ai/suggest', 'POST', { mediaId: media.id });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(suggestions);
    expect(calls.at(-1)).toBe('DELETE https://generativelanguage.googleapis.com/v1beta/files/testvideo');
  });
  it('validates Shorts dimensions and duration and retains the selected format', async () => {
    const { media } = await seed();
    const input = { title: 'Portrait clip', mediaId: media.id, platforms: ['youtube'], action: 'draft', youtubeFormat: 'short' };
    for (const videoMetadata of [undefined, { width: 1920, height: 1080, duration: 30 }, { width: 1080, height: 1920, duration: 180.1 }]) {
      expect((await call('/api/posts', 'POST', { ...input, videoMetadata })).status).toBe(400);
    }
    for (const width of [1080, 1920]) {
      const response = await call('/api/posts', 'POST', { ...input, videoMetadata: { width, height: 1920, duration: 180 } });
      expect(response.status).toBe(201);
      expect((await response.json() as any).youtubeFormat).toBe('short');
    }
  });
  it('updates a resumed draft without creating a duplicate post', async () => {
    const { post, media } = await seed();
    const response = await call('/api/posts/' + post.id, 'PUT', {
      title: 'Resumed project',
      caption: 'Updated description',
      mediaId: media.id,
      platforms: ['youtube', 'instagram'],
      action: 'draft',
      youtubeFormat: 'short',
      videoMetadata: { width: 1080, height: 1920, duration: 30 },
    });
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.title).toBe('Resumed project');
    expect(body.platforms.sort()).toEqual(['instagram', 'youtube']);
    expect(body.youtubeFormat).toBe('short');
    expect((await e.DB.prepare('SELECT COUNT(*) AS count FROM posts').first<any>()).count).toBe(1);
  });
  it('reports Google upload rejection details without exposing credentials or session URLs', async () => {
    const { media } = await seed();
    const apiKey = 'test-gemini-secret';
    const uploadUrl = 'https://generativelanguage.googleapis.com/upload/session?upload_id=secret';
    await saveCredential(e, user, 'gemini', { apiKey });
    vi.mocked(fetch).mockImplementation(async () => {
      if (vi.mocked(fetch).mock.calls.length === 1) return new Response('{}', { headers: { 'X-Goog-Upload-URL': uploadUrl } });
      // Reject before consuming the body, as an upstream server can do.
      return Response.json({ error: { message: `Invalid upload length for ${uploadUrl} with ${apiKey}` } }, { status: 400 });
    });
    const response = await call('/api/ai/suggest', 'POST', { mediaId: media.id });
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('video transfer failed (HTTP 400)');
    expect(body).toContain('Invalid upload length');
    expect(body).not.toContain(apiKey);
    expect(body).not.toContain('upload_id=secret');
  });
  it('denies unauthenticated access with JSON, not SPA HTML', async () => {
    const response = await call('/api/posts', 'GET', undefined, false);
    expect(response.status).toBe(401);
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });
  it('enforces owner allowlist and CSRF', async () => {
    expect(ownerAllowed('owner@example.com', 'attacker@example.com')).toBe(false);
    expect((await call('/api/settings', 'PUT', {}, true, { 'X-CSRF-Token': 'wrong' })).status).toBe(403);
    expect((await call('/api/settings', 'PUT', {}, true, { Origin: 'https://evil.example' })).status).toBe(
      403,
    );
  });
  it('revokes a session on logout', async () => {
    expect((await call('/api/auth/session')).status).toBe(200);
    expect((await call('/api/auth/logout', 'POST')).status).toBe(200);
    expect((await call('/api/auth/session')).status).toBe(401);
  });
  it('rejects OAuth state replay', async () => {
    const state = 'single-use';
    await e.DB.prepare('INSERT INTO oauth_states VALUES(?,?,?,?,?,?)')
      .bind(await hash(state), 'google', user, 'nonce', 'verifier', Date.now() + 60000)
      .run();
    const headers = { Cookie: `pp_session=${token}; pp_state_google=${state}` };
    await call(`/api/oauth/google/callback?state=${state}`, 'GET', undefined, true, headers);
    expect(await e.DB.prepare('SELECT id FROM oauth_states').first()).toBeNull();
    const response = await call(`/api/oauth/google/callback?state=${state}`, 'GET', undefined, true, headers);
    expect(response.headers.get('Location')).toContain('already%20used');
  });
  it('returns JSON for unknown authenticated API routes', async () => {
    expect((await call('/api/no-such-route')).status).toBe(404);
  });
});
describe('encryption and media', () => {
  it('binds ciphertext to its owner and rejects tampering', async () => {
    const encrypted = await seal(e, { token: 'secret' }, 'owner:google');
    expect(encrypted).not.toContain('secret');
    expect(await unseal(e, encrypted, 'owner:google')).toEqual({ token: 'secret' });
    await expect(unseal(e, encrypted, 'other:google')).rejects.toThrow();
  });
  it('rejects expired and modified delivery signatures', async () => {
    const expires = Date.now() + 10000,
      signature = await signMedia(e, 'asset', expires);
    expect(await validMediaSignature(e, 'asset', expires, signature)).toBe(true);
    expect(await validMediaSignature(e, 'other', expires, signature)).toBe(false);
    expect(await validMediaSignature(e, 'asset', Date.now() - 1, signature)).toBe(false);
  });
  it('serves byte ranges and blocks unsigned media', async () => {
    const { media } = await seed();
    const r = await call(`/media-files/${media.id}`, 'GET', undefined, true, { Range: 'bytes=1-2' });
    expect(r.status).toBe(206);
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([2, 3]);
    expect((await call(`/media-delivery/${media.id}`, 'GET', undefined, false)).status).toBe(403);
  });
  it('enforces media ownership', async () => {
    const { media } = await seed();
    await e.DB.prepare('INSERT INTO users VALUES(?,?,?,?)')
      .bind('other', 'other@example.com', 'Other', now())
      .run();
    await e.DB.prepare('UPDATE media SET user_id=? WHERE id=?').bind('other', media.id).run();
    expect((await call(`/api/media/${media.id}`)).status).toBe(404);
  });
  it('verifies completion and makes replay safe', async () => {
    const started = await call('/api/media/uploads', 'POST', {
      name: 'test.mp4',
      type: 'video/mp4',
      size: 4,
    });
    expect(started.status).toBe(201);
    const upload: any = await started.json();
    const ctx = createExecutionContext();
    const part = await app.fetch(
      new Request(`${e.APP_ORIGIN}/api/media/uploads/${upload.id}/parts/1`, {
        method: 'PUT',
        headers: { Cookie: `pp_session=${token}`, Origin: e.APP_ORIGIN, 'X-CSRF-Token': csrf },
        body: new Uint8Array([1, 2, 3, 4]),
      }),
      e,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(part.status).toBe(200);
    const uploaded: any = await part.json();
    const completed = await call(`/api/media/uploads/${upload.id}/complete`, 'POST', { parts: [uploaded] });
    expect(completed.status).toBe(201);
    expect(
      (await call(`/api/media/uploads/${upload.id}/complete`, 'POST', { parts: [uploaded] })).status,
    ).toBe(200);
    expect((await e.DB.prepare('SELECT COUNT(*) AS n FROM media').first<{ n: number }>())?.n).toBe(1);
  });
  it('rejects a size mismatch before registering media', async () => {
    const r: any = await (
      await call('/api/media/uploads', 'POST', { name: 'x.mp4', type: 'video/mp4', size: 4 })
    ).json();
    const u: any = await e.DB.prepare('SELECT * FROM uploads WHERE id=?').bind(r.id).first();
    await e.MEDIA.put(u.object_key, new Uint8Array([1]), { httpMetadata: { contentType: 'video/mp4' } });
    expect(
      (await call(`/api/media/uploads/${r.id}/complete`, 'POST', { parts: [{ partNumber: 1, etag: 'x' }] }))
        .status,
    ).toBe(400);
    expect(await e.DB.prepare('SELECT id FROM media WHERE id=?').bind(r.id).first()).toBeNull();
  });
});
describe('durable publishing boundaries', () => {
  it('concurrent schedule dispatch claims a due post once', async () => {
    const { post } = await seed();
    await e.DB.prepare("UPDATE posts SET status='scheduled',scheduled_for=? WHERE id=?")
      .bind(new Date(Date.now() - 1000).toISOString(), post.id)
      .run();
    const ids = new Set<string>();
    const fake = {
      ...e,
      PUBLISH: {
        createBatch: async (items: any[]) => {
          items.forEach((i) => ids.add(i.id));
          return [];
        },
        get: async () => ({ status: async () => ({ status: 'running' }) }),
      },
    } as unknown as Env;
    await Promise.all([dispatch(fake), dispatch(fake)]);
    expect(ids.size).toBe(1);
    expect(
      (await e.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE post_id=?').bind(post.id).first<any>()).n,
    ).toBe(1);
    expect(
      (await e.DB.prepare('SELECT attempts FROM posts WHERE id=?').bind(post.id).first<any>()).attempts,
    ).toBe(1);
  });
  it('honors the scheduler pause setting', async () => {
    const { post } = await seed();
    await e.DB.prepare("UPDATE posts SET status='scheduled',scheduled_for=? WHERE id=?")
      .bind(new Date(Date.now() - 1000).toISOString(), post.id)
      .run();
    await e.DB.prepare('INSERT INTO settings VALUES(?,?)')
      .bind(user, JSON.stringify({ schedulerEnabled: false }))
      .run();
    const createBatch = vi.fn(async () => []);
    await dispatch({ ...e, PUBLISH: { createBatch } } as unknown as Env);
    expect(createBatch).not.toHaveBeenCalled();
  });
  it('blocks retry until uncertain outcomes are explicitly resolved', async () => {
    const { post } = await seed('facebook');
    await e.DB.prepare("UPDATE targets SET status='review' WHERE post_id=?").bind(post.id).run();
    await e.DB.prepare("UPDATE posts SET status='failed' WHERE id=?").bind(post.id).run();
    expect((await call(`/api/posts/${post.id}/retry`, 'POST')).status).toBe(409);
    expect(
      (
        await call(`/api/posts/${post.id}/targets/facebook/resolve`, 'POST', {
          outcome: 'published',
          remoteId: 'remote-post',
          confirmation: 'I checked the provider account',
        })
      ).status,
    ).toBe(200);
    expect(
      (await e.DB.prepare('SELECT status FROM posts WHERE id=?').bind(post.id).first<any>()).status,
    ).toBe('published');
  });
  it('recovers undispatched jobs and uses a stable workflow ID', async () => {
    const { post } = await seed();
    const id = crypto.randomUUID();
    await e.DB.prepare('INSERT INTO runs(id,post_id,created_at) VALUES(?,?,?)')
      .bind(id, post.id, now())
      .run();
    const createBatch = vi.fn(async () => []);
    const fake = {
      ...e,
      PUBLISH: { createBatch, get: async () => ({ status: async () => ({ status: 'running' }) }) },
    } as unknown as Env;
    await dispatch(fake);
    await dispatch(fake);
    expect(createBatch).toHaveBeenCalledTimes(1);
    expect(createBatch.mock.calls[0][0][0].id).toBe(id);
  });
  it('reconciles a completed YouTube upload after a lost response', async () => {
    const { post, media } = await seed();
    await saveCredential(e, user, 'google', { accessToken: 'test', expiryDate: Date.now() + 3600000 });
    await e.DB.prepare("UPDATE targets SET status='uploading',data=? WHERE post_id=?")
      .bind(
        JSON.stringify({
          youtubeFormat: 'short',
          session: await seal(
            e,
            'https://www.googleapis.com/upload/resume-test',
            `${post.id}:youtube-session`,
          ),
        }),
        post.id,
      )
      .run();
    mockProvider('https://www.googleapis.com/upload/resume-test', { id: 'video123' }, 'PUT');
    expect(await youtubeChunk(e, post, media)).toBe(true);
    const row: any = await e.DB.prepare('SELECT * FROM targets WHERE post_id=?').bind(post.id).first();
    expect(row.status).toBe('success');
    expect(JSON.parse(row.data).id).toBe('video123');
    expect(JSON.parse(row.data).youtubeFormat).toBe('short');
    expect(JSON.parse(row.data).url).toBe('https://www.youtube.com/shorts/video123');
    expect(await youtubeChunk(e, post, media)).toBe(true);
  });
  it('does not repeat an uncertain Facebook side effect', async () => {
    const { post, media } = await seed('facebook');
    await e.DB.prepare("UPDATE targets SET status='sending' WHERE post_id=?").bind(post.id).run();
    await expect(publishFacebook(e, post, media)).rejects.toThrow('Verify the Page');
  });
  it('reconciles a published Instagram container', async () => {
    const { post } = await seed('instagram');
    await saveCredential(e, user, 'instagram', {
      accessToken: 'test',
      userId: 'ig',
      expiryDate: Date.now() + 3600000,
    });
    await e.DB.prepare("UPDATE targets SET status='sending',data=? WHERE post_id=?")
      .bind(JSON.stringify({ container: 'container' }), post.id)
      .run();
    mockProvider('https://graph.instagram.com/v25.0/container?fields=status_code', {
      status_code: 'PUBLISHED',
    });
    await publishInstagram(e, post);
    expect(
      (await e.DB.prepare('SELECT status FROM targets WHERE post_id=?').bind(post.id).first<any>()).status,
    ).toBe('success');
  });
  it('runs a real Workflow and preserves partial success', async () => {
    const { post } = await seed('youtube');
    await e.DB.prepare("UPDATE targets SET status='success',data=? WHERE post_id=?")
      .bind(JSON.stringify({ id: 'already-published' }), post.id)
      .run();
    await e.DB.prepare("INSERT INTO targets(post_id,platform) VALUES(?,'facebook')").bind(post.id).run();
    const runId = crypto.randomUUID();
    await e.DB.prepare('INSERT INTO runs(id,post_id,created_at) VALUES(?,?,?)')
      .bind(runId, post.id, now())
      .run();
    const inspect = await introspectWorkflowInstance(e.PUBLISH, runId);
    try {
      await inspect.modify(async (m) => {
        await m.disableSleeps();
      });
      await e.PUBLISH.create({ id: runId, params: { runId } });
      await inspect.waitForStatus('complete');
      expect(
        (await e.DB.prepare('SELECT status FROM posts WHERE id=?').bind(post.id).first<any>()).status,
      ).toBe('partial');
      expect(
        (
          await e.DB.prepare("SELECT status FROM targets WHERE post_id=? AND platform='youtube'")
            .bind(post.id)
            .first<any>()
        ).status,
      ).toBe('success');
    } finally {
      await inspect.dispose();
    }
  }, 20000);
  it('parses confirmed offsets rather than trusting local progress', () => {
    expect(confirmedOffset(null)).toBe(0);
    expect(confirmedOffset('bytes=0-8388607')).toBe(8388608);
    expect(() => confirmedOffset('bytes=oops')).toThrow();
  });
});
