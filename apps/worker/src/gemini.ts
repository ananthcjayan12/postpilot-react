import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, MediaRow } from './env';
import { AppError, getCredential } from './lib';
import { defaultSettings, thumbnailPeopleSchema, thumbnailPeopleOptions, thumbnailIs1KOnly } from '@postpilot/shared';
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
const socialInput = z.object({
  title: z.string().trim().min(1).max(100),
  caption: z.string().max(5000).default(''),
  referenceMediaId: z.string().uuid().optional(),
  orientation: z.enum(['horizontal', 'vertical']).default('horizontal'),
  thumbnailText: z.string().min(1).max(100).refine((text) => text.trim().length > 0, 'Enter a thumbnail headline.').optional(),
  feedback: z.string().trim().max(500).optional(),
  imageIdeas: z.string().trim().max(1000).optional(),
  regenerationFeedback: z.string().trim().max(1000).optional(),
  preserveReferenceBranding: z.boolean().default(false),
  referenceMode: z.enum(['preserve', 'style']).default('style'),
});
function decodeBase64(value: string) {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function providerKey(env: AppEnv['Bindings'], user: string, provider: 'gemini' | 'openai') {
  const key = (await getCredential(env, user, provider))?.value?.apiKey;
  if (!key) throw new AppError(`Add your ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key in Settings first.`);
  return key as string;
}
async function routes(env: AppEnv['Bindings'], user: string) {
  const row = await env.DB.prepare('SELECT data FROM settings WHERE user_id=?').bind(user).first<{ data: string }>();
  const saved = row ? JSON.parse(row.data) : {};
  return { ...defaultSettings.aiRoutes, ...(saved.aiRoutes || {}) };
}
async function languageGuidance(env: AppEnv['Bindings'], user: string) {
  const row = await env.DB.prepare('SELECT data FROM settings WHERE user_id=?').bind(user).first<{ data: string }>();
  const saved = row ? JSON.parse(row.data) : {};
  const language = { ...defaultSettings.contentLanguage, ...(saved.contentLanguage || {}) };
  if (language.mode === 'malayalam')
    return 'Write in natural Malayalam using Malayalam script. Keep proper names in their conventional form.';
  if (language.mode === 'malayalam_english')
    return 'Write in a natural Malayalam and English mix used by fluent bilingual speakers. Use Malayalam script for Malayalam words and English script for English words; do not transliterate everything.';
  if (language.mode === 'custom')
    return `Write in this requested language or language mix: ${language.custom}. Follow that instruction naturally and consistently.`;
  return 'Write in natural English.';
}
function routed(value: string) {
  const [provider, ...model] = value.split(':');
  return { provider: provider as 'gemini' | 'openai', model: model.join(':') };
}
async function referenceImage(env: AppEnv['Bindings'], user: string, id?: string) {
  if (!id) return undefined;
  const media = await env.DB.prepare("SELECT * FROM media WHERE id=? AND user_id=? AND mime LIKE 'image/%'").bind(id, user).first<MediaRow>();
  if (!media) throw new AppError('Reference image not found.', 404);
  if (media.size > 10 * 1024 * 1024) throw new AppError('Reference image must be 10 MB or smaller.');
  const object = await env.MEDIA.get(media.object_key);
  if (!object) throw new AppError('Reference image is missing from storage.', 404);
  return { media, bytes: new Uint8Array(await object.arrayBuffer()) };
}
function encodeBase64(bytes: Uint8Array) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 0x8000) value += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(value);
}
async function generateThumbnailCopy(env: AppEnv['Bindings'], user: string, title: string, caption: string, feedback?: string) {
  const route = routed((await routes(env, user)).thumbnailCopy);
  const key = await providerKey(env, user, route.provider);
  const language = await languageGuidance(env, user);
  const prompt = `Act as an expert Instagram and YouTube thumbnail copywriter. Write one compelling thumbnail headline that does two jobs: clearly conveys the specific subject or outcome of the video, and creates an honest curiosity gap that makes the intended viewer want to watch. ${language} When writing Malayalam, use natural, grammatically correct Malayalam with accurate spelling, vowel signs, chillu letters, and conjuncts. Proofread every word before returning it. Prefer familiar, unambiguous wording; do not invent words or awkward literal translations. Use 6 to 12 strong words and at most 84 characters. It should fit naturally across no more than two visual lines. Prefer a concrete transformation, tension, discovery, mistake, result, or unanswered question from the actual video. It must remain truthful and understandable without reading the caption. Do not simply repeat the video title. Avoid vague phrases, generic hype, hashtags, quotes, emoji, dishonest clickbait, or explanations. Return only the final headline.${feedback ? `\nUser feedback for this version: ${feedback}` : ''}\nVideo title: ${title}\nVideo caption: ${caption.slice(0, 1200)}`;
  let text = '';
  if (route.provider === 'gemini') {
    const body = await googleJson(`https://generativelanguage.googleapis.com/v1beta/models/${route.model}:generateContent`, key, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    text = body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
  } else {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: route.model, input: prompt }), signal: AbortSignal.timeout(120_000),
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new AppError(`OpenAI thumbnail writing failed (${response.status}).`, 502);
    text = body.output?.flatMap((o: any) => o.content || []).map((p: any) => p.text || '').join('') || '';
  }
  // Never truncate Malayalam combining marks, conjuncts, or words to fit a limit.
  const clean = text.trim().replace(/^["“]([\s\S]*)["”]$/, '$1').trim();
  if (clean.length > 100) throw new AppError('The generated headline is too long. Please generate a shorter headline.', 502);
  if (!clean) throw new AppError('The thumbnail-writing model returned no usable hook.', 502);
  return { text: clean, route };
}

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
    let detail = typeof body?.error?.message === 'string' ? body.error.message : '';
    detail = detail.split(apiKey).join('[redacted]')
      .replace(/https?:\/\/[^\s"<>]+/g, '[URL redacted]')
      .replace(/AIza[\w-]+/g, '[key redacted]')
      .slice(0, 400);
    const message = response.status === 429
      ? 'Gemini quota exceeded. Check your Google AI billing and quota, then try again.'
      : `Gemini request failed (HTTP ${response.status}). ${detail || 'Check the Gemini API key and model access.'}`;
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
    const metadataRoute = routed((await routes(c.env, user)).metadata);
    const language = await languageGuidance(c.env, user);
    const generated = await googleJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${metadataRoute.model}:generateContent`,
      apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { fileData: { mimeType: current.mimeType || media.mime, fileUri: current.uri } },
            { text: `Analyze the actual video content and suggest SEO-friendly YouTube metadata. ${formatGuidance} ${language} Return 5 distinct title suggestions (each at most 100 characters) and one useful description (at most 5000 characters). Do not invent facts, names, links, or claims not supported by the video.` },
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

gemini.post('/hashtags', async (c) => {
  const value = socialInput.parse(await c.req.json()), user = c.get('user').id;
  const route = routed((await routes(c.env, user)).hashtags), key = await providerKey(c.env, user, route.provider);
  const language = await languageGuidance(c.env, user);
  const prompt = `Create 12 relevant Instagram hashtags for this video. ${language} Use hashtags appropriate to that audience, while retaining useful English discovery tags when relevant. Return only a single space-separated line of hashtags, each beginning with #. Avoid banned, misleading, or unrelated tags.\nTitle: ${value.title}\nCaption: ${value.caption}`;
  let text = '';
  if (route.provider === 'gemini') {
    const body = await googleJson(`https://generativelanguage.googleapis.com/v1beta/models/${route.model}:generateContent`, key, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    text = body?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
  } else {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: route.model, input: prompt }), signal: AbortSignal.timeout(120_000),
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new AppError(`OpenAI hashtag generation failed (${response.status}).`, 502);
    text = body.output?.flatMap((o: any) => o.content || []).map((p: any) => p.text || '').join('') || '';
  }
  const hashtags = (text.match(/#[\p{L}\p{N}_]+/gu) || []).slice(0, 30).join(' ');
  if (!hashtags) throw new AppError('The AI provider returned no usable hashtags.', 502);
  return c.json({ hashtags, ...route });
});

gemini.post('/thumbnail-copy', async (c) => {
  const value = socialInput.parse(await c.req.json()), user = c.get('user').id;
  const copy = await generateThumbnailCopy(c.env, user, value.title, value.caption, value.feedback);
  return c.json({ thumbnailText: copy.text, provider: copy.route.provider, model: copy.route.model });
});

gemini.post('/thumbnail', async (c) => {
  const value = socialInput.parse(await c.req.json()), user = c.get('user').id;
  const route = routed((await routes(c.env, user)).thumbnail), key = await providerKey(c.env, user, route.provider);
  const resolution = (await routes(c.env, user)).thumbnailResolution as '1K' | '2K' | '4K';
  if (thumbnailIs1KOnly(`${route.provider}:${route.model}`) && resolution !== '1K')
    throw new AppError('The selected thumbnail model supports only 1K output.');
  const reference = await referenceImage(c.env, user, value.referenceMediaId);
  const copy = value.thumbnailText
    ? { text: value.thumbnailText, route: routed((await routes(c.env, user)).thumbnailCopy) }
    : await generateThumbnailCopy(c.env, user, value.title, value.caption, value.feedback);
  const aspectRatio = value.orientation === 'vertical' ? '9:16' : '16:9';
  const designDirection = reference && value.referenceMode === 'style'
    ? 'Create fresh imagery for the requested video, keeping only the reference color palette, graphic design style, and visual theme.'
    : 'Use one clear focal subject and an uncluttered high-contrast composition with ample negative space.';
  const settingsRow = await c.env.DB.prepare('SELECT data FROM settings WHERE user_id=?').bind(user).first<{ data: string }>();
  const people = thumbnailPeopleSchema.catch('auto').parse(settingsRow ? JSON.parse(settingsRow.data).thumbnailPeople : 'auto');
  const peopleDirection = reference && value.referenceMode === 'preserve'
    ? 'Preserving the reference subject identity takes priority over any generated-people preference.'
    : people === 'none' ? 'Do not include any people; use objects, scenery, or graphics to illustrate the video.'
    : people === 'auto' ? ''
    : `If people are appropriate for this video, create new fictional people with this preferred background: ${thumbnailPeopleOptions[people]}. Depict natural individual variation without stereotypes or caricatures. This preference does not require adding a person to an object-focused scene.`;
  const brandingDirection = reference && value.preserveReferenceBranding
    ? 'Preserve existing visible logos, company names, and brand names from the reference, keeping their spelling, colors, and recognizable design. These branding elements are the only exception to regenerating reference imagery and to the headline-only text rule. Do not invent branding, copy the old headline, slogans, or unrelated text. Integrate the branding legibly into the fresh composition.'
    : 'Do not add any other words, captions, logos, company names, brand names, badges, or small text, including branding visible in the reference.';
  const prompt = `Create a polished ${aspectRatio} social video thumbnail for: “${value.title}”. ${value.caption.slice(0, 800)}. ${designDirection} Render exactly this headline, large and perfectly legible, using balanced lines without breaking words or character clusters: “${copy.text}”. Give the headline strong hierarchy and enough safe margin for an Instagram or YouTube cover. ${peopleDirection} ${brandingDirection} Never make misleading claims.${value.imageIdeas ? `\nUser visual ideas (art direction, not text to render): ${value.imageIdeas}` : ''}.${value.regenerationFeedback ? `\nCreate a new thumbnail variation incorporating this feedback on the previous result (not text to render): ${value.regenerationFeedback}. Keep the exact requested headline and the selected reference and branding rules.` : ''}`;
  const exactHeadlineDirection = `HEADLINE ACCURACY IS MANDATORY. The following JSON string is the authoritative text to typeset (decode the JSON escapes; do not print the enclosing quotes): ${JSON.stringify(copy.text)}. Copy it verbatim. Do not translate, transliterate, paraphrase, spell-correct, shorten, expand, change capitalization, replace punctuation, or add or omit characters. Neither the video title, reference text, nor visual feedback may override this headline. For Malayalam, preserve every vowel sign, chillu letter, conjunct, virama, and combining mark in its correct position. Use a clear Malayalam-capable typeface with correct shaping; never imitate Malayalam with decorative pseudo-letters. Fit the design around the full headline rather than editing the text. Before finalizing, visually proofread every word against the authoritative headline and correct any missing, duplicated, or malformed glyphs.`;
  const styleReferenceDirection = 'Use the supplied thumbnail only to understand its color palette, graphic design style, typography treatment, and visual theme. Generate all photographic or illustrated imagery from scratch based on the requested video title and caption. Create a new subject depiction, pose, camera angle, scene, and background, even when the video covers the same topic as the reference. Do not copy, trace, reuse, or closely reconstruct any reference person, face, product depiction, object arrangement, photograph, illustration, or background scene. Do not merely change the headline, recolor, crop, or lightly edit the reference. Keep the same aesthetic through colors, font style, contrast, and graphic effects, with a fresh composition suited to the new imagery and exact requested headline. The reference is a style guide, not a source image to preserve.';
  let data = '', mime = 'image/png';
  if (route.provider === 'gemini') {
    const input: any[] = [];
    if (reference) input.push({ type: 'image', mime_type: reference.media.mime, data: encodeBase64(reference.bytes) });
    const referenceDirection = value.referenceMode === 'style'
      ? styleReferenceDirection
      : 'The supplied image is the primary source reference. Preserve the recognizable subject or product identity, facial features, proportions, distinctive objects, clothing, colors, and visual character. Recompose it only as needed for the thumbnail canvas and headline. Do not replace it with a different person, product, or generic substitute.';
    input.push({ type: 'text', text: reference ? `${prompt} ${referenceDirection} ${exactHeadlineDirection}` : `${prompt} ${exactHeadlineDirection}` });
    const body = await googleJson('https://generativelanguage.googleapis.com/v1beta/interactions', key, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: route.model, input, response_format: { type: 'image', aspect_ratio: aspectRatio, ...(thumbnailIs1KOnly(`${route.provider}:${route.model}`) ? {} : { image_size: resolution }) } }),
    });
    const part = body?.steps?.filter((step: any) => step.type === 'model_output').flatMap((step: any) => step.content || []).find((item: any) => item.type === 'image' && item.data);
    data = part?.data || ''; mime = part?.mime_type || mime;
  } else {
    let response: Response;
    const openaiSize = value.orientation === 'vertical'
      ? { '1K': '768x1376', '2K': '1152x2048', '4K': '2160x3840' }[resolution]
      : { '1K': '1376x768', '2K': '2048x1152', '4K': '3840x2160' }[resolution];
    if (reference) {
      const form = new FormData();
      const referenceDirection = value.referenceMode === 'style'
        ? styleReferenceDirection
        : 'Treat the supplied image as the primary source image, not loose inspiration. Preserve the recognizable identity and facial structure of any person, or the exact defining shape, markings, colors, and details of any product or object. Keep its visual character intact while changing only composition, crop, background, lighting, and headline placement as needed for the thumbnail.';
      form.set('model', route.model); form.set('prompt', `${prompt} ${referenceDirection} ${exactHeadlineDirection}`);
      form.set('image[]', new Blob([reference.bytes], { type: reference.media.mime }), reference.media.name);
      form.set('size', openaiSize); form.set('quality', 'high'); form.set('output_format', 'png');
      response = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(120_000) });
    } else response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: route.model, prompt: `${prompt} ${exactHeadlineDirection}`, size: openaiSize, quality: 'low', output_format: 'png' }), signal: AbortSignal.timeout(120_000),
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new AppError(`OpenAI thumbnail generation failed (${response.status}).`, 502);
    data = body?.data?.[0]?.b64_json || '';
  }
  if (!data) throw new AppError('The AI provider returned no image.', 502);
  const bytes = decodeBase64(data), id = crypto.randomUUID(), objectKey = `${user}/${id}`;
  if (bytes.byteLength > 40 * 1024 * 1024) throw new AppError('Generated thumbnail is too large.', 502);
  await c.env.MEDIA.put(objectKey, bytes, { httpMetadata: { contentType: mime } });
  await c.env.DB.prepare('INSERT INTO media(id,user_id,object_key,name,mime,size,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind(id, user, objectKey, `ai-thumbnail-${id}.png`, mime, bytes.byteLength, new Date().toISOString()).run();
  return c.json({ id, originalName: `AI thumbnail (${route.provider}, ${resolution}, ${value.orientation})`, fileName: objectKey, mimeType: mime, size: bytes.byteLength, createdAt: new Date().toISOString(), localUrl: `/media-files/${id}`, ...route, resolution, orientation: value.orientation, thumbnailText: copy.text, copyModel: copy.route.model }, 201);
});
