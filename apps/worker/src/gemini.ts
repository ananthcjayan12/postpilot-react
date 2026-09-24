import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, MediaRow } from './env';
import { AppError, getCredential } from './lib';
import { requireSession } from './auth';

export const gemini = new Hono<AppEnv>();
gemini.use('*', requireSession);

const input = z.object({
  mediaId: z.string().uuid(),
  youtubeFormat: z.enum(['video', 'short']).default('video'),
});
const suggestionsSchema = z.object({
  titles: z.array(z.string().trim().min(1).max(100)).length(5),
  description: z.string().trim().min(1).max(5000),
});

async function googleJson(url: string, apiKey: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(120_000),
    headers: { 'x-goog-api-key': apiKey, ...(init?.headers || {}) },
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status === 429 ? 'Gemini quota exceeded. Check your Google AI billing and quota, then try again.' : `Gemini request failed (${response.status}). Check your API key, model access and video format.`;
    throw new AppError(message, response.status === 401 || response.status === 403 ? 400 : 502);
  }
  return body;
}

async function uploadVideo(env: AppEnv['Bindings'], media: MediaRow, apiKey: string) {
  if (media.size > 2 * 1024 ** 3) throw new AppError('Gemini video analysis supports files up to 2 GB.');
  const start = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
    signal: AbortSignal.timeout(30_000),
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(media.size),
      'X-Goog-Upload-Header-Content-Type': media.mime,
    },
    body: JSON.stringify({ file: { displayName: media.name } }),
  });
  if (!start.ok) throw new AppError('Gemini could not start the video upload. Check the API key and quota.', 502);
  const uploadUrl = start.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl?.startsWith('https://generativelanguage.googleapis.com/'))
    throw new AppError('Gemini returned an invalid upload URL.', 502);
  const object = await env.MEDIA.get(media.object_key);
  if (!object?.body) throw new AppError('Uploaded video could not be found.', 404);
  const uploaded = await fetch(uploadUrl, {
    signal: AbortSignal.timeout(120_000),
    method: 'POST',
    headers: {
      'Content-Length': String(media.size),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: object.body,
  });
  const result: any = await uploaded.json().catch(() => ({}));
  if (!uploaded.ok || !/^files\/[a-zA-Z0-9_-]+$/.test(result.file?.name || '')) throw new AppError('Gemini could not upload the video.', 502);
  return result.file as { name: string; uri: string; mimeType: string; state?: string };
}

gemini.post('/suggest', async (c) => {
  const value = input.parse(await c.req.json());
  const user = c.get('user').id;
  const media = await c.env.DB.prepare('SELECT * FROM media WHERE id=? AND user_id=?')
    .bind(value.mediaId, user)
    .first<MediaRow>();
  if (!media || !media.mime.startsWith('video/')) throw new AppError('Choose an uploaded video first.');
  const credential = await getCredential(c.env, user, 'gemini');
  const apiKey = credential?.value?.apiKey;
  if (!apiKey) throw new AppError('Add your Gemini API key in Settings before generating suggestions.');

  const file = await uploadVideo(c.env, media, apiKey);
  try {
    let current = file;
    for (let attempt = 0; current.state !== 'ACTIVE' && attempt < 20; attempt++) {
      if (current.state === 'FAILED') throw new AppError('Gemini could not process this video.', 502);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      current = await googleJson(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, apiKey);
    }
    if (current.state !== 'ACTIVE') throw new AppError('Video processing took too long. Try again with a shorter video.', 504);
    const formatGuidance = value.youtubeFormat === 'short'
      ? 'This is intended as a YouTube Short. Use a punchy title, front-load the hook, and keep it concise.'
      : 'This is intended as a standard YouTube video. Optimize for search intent without clickbait.';
    const generated = await googleJson(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { fileData: { mimeType: current.mimeType || media.mime, fileUri: current.uri } },
            { text: `Analyze the actual video content and suggest SEO-friendly YouTube metadata. ${formatGuidance} Return 5 distinct title suggestions (each at most 100 characters) and one useful description (at most 5000 characters). Do not invent facts, names, links, or claims not supported by the video.` },
          ] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                titles: { type: 'ARRAY', items: { type: 'STRING' }, minItems: 5, maxItems: 5 },
                description: { type: 'STRING' },
              },
              required: ['titles', 'description'],
            },
          },
        }),
      },
    );
    const text = generated?.candidates?.[0]?.content?.parts?.filter((part: any) => !part.thought).map((part: any) => part.text || '').join('');
    if (!text) throw new AppError('Gemini returned no suggestions.', 502);
    let suggestions;
    try { suggestions = suggestionsSchema.parse(JSON.parse(text)); }
    catch { throw new AppError('Gemini returned invalid suggestions. Please try again.', 502); }
    return c.json(suggestions);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Gemini analysis could not finish. Please try again.', 502);
  } finally {
    c.executionCtx.waitUntil(
      fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, {
        method: 'DELETE', headers: { 'x-goog-api-key': apiKey },
      }).then(() => undefined).catch(() => undefined),
    );
  }
});
