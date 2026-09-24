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

function logGemini(event: string, fields: Record<string, unknown> = {}) {
  console.log({ service: 'gemini', event, ...fields });
}

function uploadError(stage: string, response: Response, body: any, apiKey: string, uploadUrl = '') {
  // Never echo upload-session URLs or credentials from provider error messages.
  let detail = typeof body?.error?.message === 'string' ? body.error.message : '';
  for (const secret of [apiKey, uploadUrl].filter(Boolean)) detail = detail.split(secret).join('[redacted]');
  detail = detail.replace(/https?:\/\/[^\s"<>]+/g, '[URL redacted]').replace(/AIza[\w-]+/g, '[key redacted]').slice(0, 400);
  const hint = response.status === 429 ? 'Check Google AI quota and billing.'
    : [401, 403].includes(response.status) ? 'Check the Gemini API key and its API restrictions.'
    : response.status === 411 ? 'Google requires a fixed-length upload body.'
    : 'Try again; if this persists, check the video format.';
  return new AppError(`Gemini ${stage} failed (HTTP ${response.status}). ${detail || hint}`, 502);
}

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

export async function uploadVideo(env: AppEnv['Bindings'], media: MediaRow, apiKey: string, traceId = crypto.randomUUID()) {
  const startedAt = Date.now();
  logGemini('upload_started', { traceId, mediaId: media.id, sizeBytes: media.size, mimeType: media.mime });
  if (media.size > 2 * 1024 ** 3) throw new AppError('Gemini video analysis supports files up to 2 GB.');
  const object = await env.MEDIA.head(media.object_key);
  if (!object) throw new AppError('Uploaded video could not be found.', 404);
  if (object.size !== media.size) throw new AppError('Stored video size does not match the upload record. Upload the video again.');
  let start: Response;
  try {
    start = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files', {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown network failure';
    const failure = new AppError(uploadError('initialization', new Response(null, { status: 502 }), { error: { message } }, apiKey).message, 502);
    logGemini('upload_initialization_failed', { traceId, errorName: error instanceof Error ? error.name : 'UnknownError', error: failure.message, durationMs: Date.now() - startedAt });
    throw failure;
  }
  logGemini('upload_initialized', { traceId, status: start.status, durationMs: Date.now() - startedAt, chunkGranularity: start.headers.get('X-Goog-Upload-Chunk-Granularity') });
  if (!start.ok) {
    const responseBody = await start.json().catch(() => null);
    const error = uploadError('upload initialization', start, responseBody, apiKey);
    logGemini('upload_initialization_failed', { traceId, status: start.status, error: error.message });
    throw error;
  }
  const uploadUrl = start.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl?.startsWith('https://generativelanguage.googleapis.com/'))
    throw new AppError('Gemini returned an invalid upload URL.', 502);
  // Google's resumable protocol accepts bounded chunks. ArrayBuffer bodies give
  // Workers an intrinsic length without piping a single multi-GB request.
  const granularity = Number(start.headers.get('X-Goog-Upload-Chunk-Granularity') || 262144);
  const maxChunk = 8 * 1024 ** 2;
  if (!Number.isSafeInteger(granularity) || granularity < 1 || granularity > maxChunk)
    throw new AppError('Gemini returned an unsupported upload chunk size.', 502);
  const chunkSize = Math.floor(maxChunk / granularity) * granularity;
  let uploaded!: Response;
  for (let offset = 0; offset < media.size; offset += chunkSize) {
    const length = Math.min(chunkSize, media.size - offset);
    const part = await env.MEDIA.get(media.object_key, { range: { offset, length } });
    if (!part) throw new AppError('Stored video disappeared during analysis. Upload it again.', 404);
    const bytes = await part.arrayBuffer();
    if (bytes.byteLength !== length) throw new AppError(`Video read failed at byte ${offset}: incomplete stored chunk.`, 502);
    const final = offset + length === media.size;
    const chunkStartedAt = Date.now();
    logGemini('chunk_started', { traceId, offset, length, final });
    try {
      uploaded = await fetch(uploadUrl, {
        signal: AbortSignal.timeout(120_000),
        // Cloudflare Workers only supports `follow` and `manual` here. The
        // Google upload session URL is already host-validated above.
        redirect: 'manual',
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': media.mime,
          'Content-Length': String(length),
          'X-Goog-Upload-Offset': String(offset),
          'X-Goog-Upload-Command': final ? 'upload, finalize' : 'upload',
        },
        body: bytes,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network failure';
      const timedOut = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      const detail = uploadError('transfer', new Response(null, { status: 502 }), { error: { message } }, apiKey, uploadUrl).message;
      const failure = new AppError(`Gemini ${timedOut ? 'timed out' : 'connection failed'} at byte ${offset} of ${media.size}. ${detail}`, 502);
      logGemini('chunk_failed', { traceId, offset, length, errorName: error instanceof Error ? error.name : 'UnknownError', error: failure.message, durationMs: Date.now() - chunkStartedAt });
      throw failure;
    }
    if (!uploaded.ok) {
      const responseBody = await uploaded.json().catch(() => null);
      const error = uploadError('video transfer', uploaded, responseBody, apiKey, uploadUrl);
      logGemini('chunk_rejected', { traceId, offset, length, status: uploaded.status, error: error.message, durationMs: Date.now() - chunkStartedAt });
      throw error;
    }
    logGemini('chunk_completed', { traceId, offset, length, status: uploaded.status, durationMs: Date.now() - chunkStartedAt });
    // Consume intermediate responses to release connections before the next chunk.
    if (!final) await uploaded.arrayBuffer();
  }
  const result: any = await uploaded.json().catch(() => ({}));
  if (!/^files\/[a-zA-Z0-9_-]+$/.test(result.file?.name || '')) throw new AppError(`Gemini upload completed (HTTP ${uploaded.status}) but returned no valid file reference. Please try again.`, 502);
  logGemini('upload_completed', { traceId, sizeBytes: media.size, durationMs: Date.now() - startedAt, providerState: result.file.state });
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

  const traceId = crypto.randomUUID();
  logGemini('analysis_started', { traceId, mediaId: media.id, format: value.youtubeFormat, sizeBytes: media.size, mimeType: media.mime });
  const file = await uploadVideo(c.env, media, apiKey, traceId);
  try {
    let current = file;
    for (let attempt = 0; current.state !== 'ACTIVE' && attempt < 20; attempt++) {
      if (current.state === 'FAILED') throw new AppError('Gemini could not process this video.', 502);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      current = await googleJson(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, apiKey);
      logGemini('file_processing', { traceId, attempt: attempt + 1, state: current.state });
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
    logGemini('generation_completed', { traceId, candidateCount: generated?.candidates?.length || 0, promptFeedback: generated?.promptFeedback?.blockReason || null });
    const text = generated?.candidates?.[0]?.content?.parts?.filter((part: any) => !part.thought).map((part: any) => part.text || '').join('');
    if (!text) throw new AppError('Gemini returned no suggestions.', 502);
    let suggestions;
    try { suggestions = suggestionsSchema.parse(JSON.parse(text)); }
    catch { throw new AppError('Gemini returned invalid suggestions. Please try again.', 502); }
    logGemini('analysis_completed', { traceId, titleCount: suggestions.titles.length, descriptionLength: suggestions.description.length });
    return c.json(suggestions);
  } catch (error) {
    const failure = error instanceof AppError ? error : new AppError('Gemini analysis could not finish. Please try again.', 502);
    logGemini('analysis_failed', { traceId, errorName: error instanceof Error ? error.name : 'UnknownError', error: failure.message });
    throw failure;
  } finally {
    c.executionCtx.waitUntil(
      fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, {
        method: 'DELETE', headers: { 'x-goog-api-key': apiKey },
      }).then(() => undefined).catch(() => undefined),
    );
  }
});
