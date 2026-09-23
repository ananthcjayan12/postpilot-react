import path from 'node:path';
import { config, uploadsDir } from '../config.js';
import { getMedia, loadDb, updatePost } from '../lib/store.js';
import type { Platform, PostRecord, PublishResult } from '../types.js';
import { publishYouTube } from './youtube.js';
import { publishFacebook, publishInstagram } from './meta.js';

const inFlight = new Set<string>();

function publicMediaUrl(mediaId: string) {
  if (!config.publicBaseUrl) {
    throw new Error('Meta publishing needs PUBLIC_BASE_URL so Meta can fetch the media. Start a free HTTPS tunnel and set PUBLIC_BASE_URL in .env.');
  }
  return `${config.publicBaseUrl}/media-files/${encodeURIComponent(mediaId)}`;
}

async function publishPlatform(post: PostRecord, platform: Platform): Promise<PublishResult> {
  const media = await getMedia(post.mediaId);
  if (!media) return { ok: false, error: 'Uploaded media file could not be found.' };
  const filePath = path.resolve(uploadsDir, media.fileName);
  try {
    if (platform === 'youtube') {
      if (!media.mimeType.startsWith('video/')) throw new Error('YouTube publishing currently requires a video file.');
      const result = await publishYouTube({ filePath, title: post.title, description: post.caption });
      return { ok: true, ...result };
    }
    const mediaUrl = publicMediaUrl(media.id);
    if (platform === 'instagram') {
      const result = await publishInstagram({ mediaUrl, mimeType: media.mimeType, caption: post.caption });
      return { ok: true, ...result };
    }
    const result = await publishFacebook({ mediaUrl, mimeType: media.mimeType, title: post.title, caption: post.caption });
    return { ok: true, ...result };
  } catch (error: any) {
    return { ok: false, error: error?.message || String(error) };
  }
}

export async function publishPostById(postId: string): Promise<PostRecord> {
  if (inFlight.has(postId)) {
    const current = (await loadDb()).posts.find((p) => p.id === postId);
    if (!current) throw new Error('Post not found.');
    return current;
  }
  inFlight.add(postId);
  try {
    const db = await loadDb();
    const post = db.posts.find((p) => p.id === postId);
    if (!post) throw new Error('Post not found.');
    await updatePost(post.id, { status: 'publishing', attempts: post.attempts + 1, lastError: undefined });

    const results = { ...post.results };
    for (const platform of post.platforms) {
      // A retry must not duplicate a channel that already succeeded during a partial publish.
      if (results[platform]?.ok) continue;
      const result = await publishPlatform(post, platform);
      results[platform] = result;
      await updatePost(post.id, { results });
    }

    const selected = post.platforms.map((p) => results[p]);
    const successCount = selected.filter((r) => r?.ok).length;
    const status = successCount === selected.length ? 'published' : successCount > 0 ? 'partial' : 'failed';
    const lastError = selected.filter((r) => !r?.ok).map((r) => r?.error).filter(Boolean).join(' | ') || undefined;
    const final = await updatePost(post.id, { status, results, lastError });
    if (!final) throw new Error('Post disappeared while publishing.');
    return final;
  } finally {
    inFlight.delete(postId);
  }
}

export function startScheduler() {
  const tick = async () => {
    const db = await loadDb();
    if (!db.settings.schedulerEnabled) return;
    const now = Date.now();
    const due = db.posts.filter((p) => p.status === 'scheduled' && p.scheduledFor && new Date(p.scheduledFor).getTime() <= now);
    for (const post of due) {
      void publishPostById(post.id).catch((error) => console.error(`Scheduled publish failed for ${post.id}:`, error));
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 15_000);
  timer.unref();
  return timer;
}
