import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import type { Env, PostRow, MediaRow, Target } from './env';
import { now, getCredential, signMedia, seal, unseal, AppError } from './lib';
import { googleToken, facebookGraph, instagramGraph, instagramToken } from './oauth';
const retry = {
  retries: {
    limit: 4,
    delay: ({ error }: { error: Error }) => {
      const requested = /retry after (\d+) milliseconds/.exec(error.message);
      return requested ? Number(requested[1]) : 10_000;
    },
    backoff: 'exponential',
  },
  timeout: '5 minutes',
} as const;
class ReviewError extends Error {}
export async function target(env: Env, id: string, platform: string) {
  const t = await env.DB.prepare('SELECT * FROM targets WHERE post_id=? AND platform=?')
    .bind(id, platform)
    .first<Target>();
  if (!t) throw new NonRetryableError('Publishing target missing.');
  return { ...t, value: JSON.parse(t.data) };
}
async function save(
  env: Env,
  id: string,
  platform: string,
  status: string,
  data: any,
  error: string | null = null,
) {
  await env.DB.prepare('UPDATE targets SET status=?,data=?,error=? WHERE post_id=? AND platform=?')
    .bind(status, JSON.stringify(data), error, id, platform)
    .run();
}
export function confirmedOffset(range: string | null) {
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  if (!match) throw new NonRetryableError('Invalid resumable upload offset.');
  return Number(match[1]) + 1;
}
async function checked(response: Response) {
  if (response.status === 429 || response.status >= 500) {
    const header = response.headers.get('Retry-After');
    const delay = header
      ? /^\d+$/.test(header)
        ? Number(header) * 1000
        : Date.parse(header) - Date.now()
      : 10000;
    throw new Error(
      `Provider temporarily unavailable; retry after ${Number.isFinite(delay) ? Math.max(10000, delay) : 10000} milliseconds.`,
    );
  }
  if (!response.ok)
    throw new NonRetryableError(
      `Provider rejected request (${response.status}); check authorization, format and quota.`,
    );
  return response.json() as Promise<any>;
}
async function readFacebook(env: Env, path: string, token: string) {
  return checked(
    await fetch(facebookGraph(env, path), { headers: { Authorization: `Bearer ${token}` } }),
  );
}
async function readInstagram(env: Env, path: string, token: string) {
  return checked(
    await fetch(instagramGraph(env, path), { headers: { Authorization: `Bearer ${token}` } }),
  );
}
async function facebookToken(env: Env, user: string) {
  const grant =
    (await getCredential(env, user, 'facebook')) || (await getCredential(env, user, 'meta'));
  if (!grant) throw new NonRetryableError('Connect Facebook before publishing.');
  return grant.value;
}
async function instagramGrant(env: Env, user: string) {
  const grant = await getCredential(env, user, 'instagram');
  if (!grant) throw new NonRetryableError('Connect Instagram before publishing.');
  return { ...grant.value, accessToken: await instagramToken(env, user) };
}
async function delivery(env: Env, id: string) {
  if (!env.APP_ORIGIN.startsWith('https://'))
    throw new NonRetryableError('Meta requires a public HTTPS origin.');
  const expires = Date.now() + 2 * 86400000;
  return `${env.APP_ORIGIN}/media-delivery/${id}?${new URLSearchParams({ expires: String(expires), signature: await signMedia(env, id, expires) })}`;
}
export async function youtubeChunk(env: Env, post: PostRow, media: MediaRow) {
  let t = await target(env, post.id, 'youtube');
  if (t.status === 'success') return true;
  if (!media.mime.startsWith('video/')) throw new NonRetryableError('YouTube requires a video.');
  const token = await googleToken(env, post.user_id);
  const headers = { Authorization: `Bearer ${token}` };
  let session: string;
  if (t.value.session) {
    session = await unseal<string>(env, t.value.session, `${post.id}:youtube-session`);
  } else {
    // Starting a session does not publish a video. An orphaned empty session is safe.
    const response = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'X-Upload-Content-Length': String(media.size),
          'X-Upload-Content-Type': media.mime,
        },
        body: JSON.stringify({
          snippet: {
            title: post.title,
            description: post.caption,
            categoryId: '22',
          },
          status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
        }),
      },
    );
    if (!response.ok) await checked(response);
    session = response.headers.get('Location') || '';
    const url = new URL(session);
    if (
      url.protocol !== 'https:' ||
      !(url.hostname === 'www.googleapis.com' || url.hostname.endsWith('.googleapis.com'))
    )
      throw new NonRetryableError('Unexpected upload session URL.');
    t.value.session = await seal(env, session, `${post.id}:youtube-session`);
    t.value.offset = 0;
    await save(env, post.id, 'youtube', 'uploading', t.value);
  }
  // Probe before every chunk, including replay after a lost final response.
  const probe = await fetch(session, {
    method: 'PUT',
    headers: { ...headers, 'Content-Length': '0', 'Content-Range': `bytes */${media.size}` },
  });
  if (probe.status === 200 || probe.status === 201) {
    const result: any = await probe.json();
    if (!result.id) throw new ReviewError('Upload completed without a retrievable video ID.');
    await save(env, post.id, 'youtube', 'success', {
      youtubeFormat: t.value.youtubeFormat || 'video',
      id: result.id,
      url: t.value.youtubeFormat === 'short' ? `https://www.youtube.com/shorts/${result.id}` : `https://www.youtube.com/watch?v=${result.id}`,
    });
    return true;
  }
  if ([404, 410].includes(probe.status))
    throw new ReviewError('YouTube upload session expired. Verify the channel before retrying.');
  if (probe.status !== 308) await checked(probe);
  const offset = confirmedOffset(probe.headers.get('Range'));
  if (offset >= media.size) throw new Error('Waiting for YouTube completion.');
  const length = Math.min(8 * 1024 ** 2, media.size - offset),
    object = await env.MEDIA.get(media.object_key, { range: { offset, length } });
  if (!object) throw new NonRetryableError('Media object missing.');
  // Only one bounded chunk is buffered, below the Worker memory limit.
  const response = await fetch(session, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': media.mime,
      'Content-Length': String(length),
      'Content-Range': `bytes ${offset}-${offset + length - 1}/${media.size}`,
    },
    body: await object.arrayBuffer(),
  });
  if (response.status === 308) {
    t.value.offset = confirmedOffset(response.headers.get('Range'));
    await save(env, post.id, 'youtube', 'uploading', t.value);
    return false;
  }
  const result = await checked(response);
  if (!result.id) throw new ReviewError('YouTube result is missing an ID.');
  await save(env, post.id, 'youtube', 'success', {
    youtubeFormat: t.value.youtubeFormat || 'video',
    id: result.id,
    url: t.value.youtubeFormat === 'short' ? `https://www.youtube.com/shorts/${result.id}` : `https://www.youtube.com/watch?v=${result.id}`,
  });
  return true;
}
async function createInstagram(env: Env, post: PostRow, media: MediaRow) {
  const t = await target(env, post.id, 'instagram');
  if (t.value.container || t.status === 'success') return;
  const grant = await instagramGrant(env, post.user_id);
  if (!grant.userId) throw new NonRetryableError('Instagram connection is missing an account ID.');
  // Container creation itself does not publish. An orphan can expire safely.
  const body = new URLSearchParams({
    caption: post.caption.slice(0, 2200),
    ...(media.mime.startsWith('video/')
      ? { media_type: 'REELS', video_url: await delivery(env, media.id), share_to_feed: 'true' }
      : { image_url: await delivery(env, media.id) }),
  });
  const result = await checked(
    await fetch(instagramGraph(env, `${grant.userId}/media`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${grant.accessToken}` },
      body,
    }),
  );
  if (!result.id) throw new NonRetryableError('Instagram returned no container ID.');
  await save(env, post.id, 'instagram', 'processing', { container: result.id });
}
async function instagramStatus(env: Env, post: PostRow) {
  const t = await target(env, post.id, 'instagram');
  if (t.status === 'success') return 'PUBLISHED';
  const grant = await instagramGrant(env, post.user_id);
  const result = await readInstagram(
    env,
    `${t.value.container}?fields=status_code`,
    grant.accessToken,
  );
  return String(result.status_code);
}
export async function publishInstagram(env: Env, post: PostRow) {
  const t = await target(env, post.id, 'instagram');
  if (t.status === 'success') return;
  const grant = await instagramGrant(env, post.user_id);
  if (t.status === 'sending') {
    const state = await readInstagram(
      env,
      `${t.value.container}?fields=status_code`,
      grant.accessToken,
    );
    if (state.status_code === 'PUBLISHED') {
      await save(env, post.id, 'instagram', 'success', { ...t.value, reconciled: true });
      return;
    }
    throw new ReviewError(
      'Instagram publish result is uncertain. Verify the account before publishing again.',
    );
  }
  await save(env, post.id, 'instagram', 'sending', t.value);
  const response = await fetch(instagramGraph(env, `${grant.userId}/media_publish`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${grant.accessToken}` },
    body: new URLSearchParams({ creation_id: t.value.container }),
  });
  if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    await save(env, post.id, 'instagram', 'failed', t.value, 'Instagram rejected publishing.');
    await checked(response);
  }
  const result = await checked(response);
  if (!result.id) throw new ReviewError('Instagram did not return a post ID.');
  await save(env, post.id, 'instagram', 'success', { ...t.value, id: result.id });
}
export async function publishFacebook(env: Env, post: PostRow, media: MediaRow) {
  const t = await target(env, post.id, 'facebook');
  if (t.status === 'success' || t.value.id) return;
  if (t.status === 'sending')
    throw new ReviewError('Facebook may have accepted this post. Verify the Page before publishing again.');
  const g = await facebookToken(env, post.user_id),
    image = media.mime.startsWith('image/'),
    url = await delivery(env, media.id);
  await save(env, post.id, 'facebook', 'sending', t.value);
  const response = await fetch(facebookGraph(env, `${g.pageId}/${image ? 'photos' : 'videos'}`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${g.pageAccessToken}` },
    body: new URLSearchParams(
      image
        ? { url, caption: post.caption, published: 'true' }
        : { file_url: url, title: post.title, description: post.caption, published: 'true' },
    ),
  });
  if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    await save(env, post.id, 'facebook', 'failed', t.value, 'Facebook rejected publishing.');
    await checked(response);
  }
  const result = await checked(response),
    id = result.post_id || result.id;
  if (!id) throw new ReviewError('Facebook returned no post ID.');
  await save(env, post.id, 'facebook', image ? 'success' : 'processing', {
    id,
    url: `https://www.facebook.com/${id}`,
  });
}
async function facebookStatus(env: Env, post: PostRow) {
  const t = await target(env, post.id, 'facebook');
  if (t.status === 'success') return true;
  const g = await facebookToken(env, post.user_id);
  const r = await readFacebook(env, `${t.value.id}?fields=status`, g.pageAccessToken);
  if (r.status?.video_status === 'error') throw new NonRetryableError('Facebook video processing failed.');
  if (r.status?.video_status === 'ready') {
    await save(env, post.id, 'facebook', 'success', t.value);
    return true;
  }
  return false;
}
export class PublishPost extends WorkflowEntrypoint<Env, { runId: string }> {
  async run(event: WorkflowEvent<{ runId: string }>, step: WorkflowStep) {
    const runId = event.payload.runId;
    const context = await step.do('load publishing run', async () => {
      const run = await this.env.DB.prepare('SELECT post_id,status FROM runs WHERE id=?')
        .bind(runId)
        .first<{ post_id: string; status: string }>();
      if (!run) throw new NonRetryableError('Run missing.');
      const post = await this.env.DB.prepare('SELECT * FROM posts WHERE id=?')
        .bind(run.post_id)
        .first<PostRow>();
      if (!post) throw new NonRetryableError('Post missing.');
      const media = await this.env.DB.prepare('SELECT * FROM media WHERE id=? AND user_id=?')
        .bind(post.media_id, post.user_id)
        .first<MediaRow>();
      if (!media) throw new NonRetryableError('Media missing.');
      const platforms = (
        await this.env.DB.prepare('SELECT platform FROM targets WHERE post_id=?')
          .bind(post.id)
          .all<{ platform: string }>()
      ).results.map((t) => t.platform);
      return { post, media, platforms };
    });
    for (const platform of context.platforms) {
      const skip = await step.do(`${platform} check completion`, async () => {
        const t = await target(this.env, context.post.id, platform);
        return t.status === 'success' || t.status === 'review';
      });
      if (skip) continue;
      try {
        if (platform === 'youtube') {
          let complete = false;
          for (let chunk = 0; chunk < 700; chunk++) {
            complete = await step.do(`youtube chunk ${chunk}`, retry, () =>
              youtubeChunk(this.env, context.post, context.media),
            );
            if (complete) break;
          }
          if (!complete) throw new ReviewError('Upload exceeded its recovery budget.');
        } else if (platform === 'instagram') {
          await step.do('instagram create container', retry, () =>
            createInstagram(this.env, context.post, context.media),
          );
          let ready = false;
          for (let poll = 0; poll < 120; poll++) {
            const state = await step.do(`instagram status ${poll}`, retry, () =>
              instagramStatus(this.env, context.post),
            );
            if (['FINISHED', 'PUBLISHED'].includes(state)) {
              ready = true;
              break;
            }
            if (['ERROR', 'EXPIRED'].includes(state))
              throw new NonRetryableError(`Instagram processing ${state.toLowerCase()}.`);
            await step.sleep(`instagram wait ${poll}`, '15 seconds');
          }
          if (!ready) throw new NonRetryableError('Instagram processing timed out.');
          await step.do('instagram publish', retry, () => publishInstagram(this.env, context.post));
        } else {
          await step.do('facebook publish', retry, () =>
            publishFacebook(this.env, context.post, context.media),
          );
          if (context.media.mime.startsWith('video/')) {
            let ready = false;
            for (let poll = 0; poll < 120; poll++) {
              ready = await step.do(`facebook status ${poll}`, retry, () =>
                facebookStatus(this.env, context.post),
              );
              if (ready) break;
              await step.sleep(`facebook wait ${poll}`, '15 seconds');
            }
            if (!ready) throw new ReviewError('Facebook video processing is still pending. Verify the Page.');
          }
        }
      } catch (error) {
        await step.do(`${platform} record failure`, async () => {
          const t = await target(this.env, context.post.id, platform);
          if (t.status === 'success') return;
          const review =
            error instanceof ReviewError ||
            t.status === 'sending' ||
            !!t.value.session ||
            (platform === 'facebook' && !!t.value.id);
          const message = review
            ? 'Provider outcome needs review; check the remote account before retrying.'
            : error instanceof NonRetryableError || error instanceof AppError
              ? error.message
              : 'Publishing failed after bounded retries. Check provider availability and reconnect if needed.';
          await this.env.DB.batch([
            this.env.DB.prepare('UPDATE targets SET status=?,error=? WHERE post_id=? AND platform=?').bind(
              review ? 'review' : 'failed',
              message,
              context.post.id,
              platform,
            ),
            this.env.DB.prepare(
              'INSERT INTO attempts(id,run_id,platform,message,created_at) VALUES(?,?,?,?,?)',
            ).bind(crypto.randomUUID(), runId, platform, message, now()),
          ]);
        });
      }
    }
    await step.do('finalize publishing run', async () => {
      const ts = (
        await this.env.DB.prepare('SELECT * FROM targets WHERE post_id=?').bind(context.post.id).all<Target>()
      ).results;
      const successes = ts.filter((t) => t.status === 'success').length;
      await this.env.DB.batch([
        this.env.DB.prepare('UPDATE posts SET status=?,last_error=?,updated_at=? WHERE id=?').bind(
          successes === ts.length ? 'published' : successes ? 'partial' : 'failed',
          ts
            .filter((t) => t.error)
            .map((t) => `${t.platform}: ${t.error}`)
            .join(' | ') || null,
          now(),
          context.post.id,
        ),
        this.env.DB.prepare("UPDATE runs SET status='complete',finished_at=? WHERE id=?").bind(now(), runId),
      ]);
    });
    return { runId };
  }
}
