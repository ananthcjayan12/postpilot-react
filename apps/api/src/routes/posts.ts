import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { loadDb, upsertPost, updatePost } from '../lib/store.js';
import { publishPostById } from '../integrations/publisher.js';
import type { Platform, PostRecord } from '../types.js';

export const postsRouter = Router();

const schema = z.object({
  title: z.string().min(1).max(100),
  caption: z.string().max(5000).default(''),
  mediaId: z.string().uuid(),
  platforms: z.array(z.enum(['youtube', 'instagram', 'facebook'])).min(1),
  action: z.enum(['draft', 'schedule', 'publish']),
  scheduledFor: z.string().datetime().optional()
});

postsRouter.get('/', async (_req, res) => {
  const db = await loadDb();
  res.json(db.posts);
});

postsRouter.post('/', async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const value = parsed.data;
  if (value.action === 'schedule' && !value.scheduledFor) return res.status(400).json({ error: 'scheduledFor is required when scheduling.' });
  if (value.scheduledFor && new Date(value.scheduledFor).getTime() <= Date.now() && value.action === 'schedule') {
    return res.status(400).json({ error: 'Schedule time must be in the future.' });
  }
  const now = new Date().toISOString();
  const post: PostRecord = {
    id: randomUUID(),
    title: value.title,
    caption: value.caption,
    mediaId: value.mediaId,
    platforms: value.platforms as Platform[],
    status: value.action === 'draft' ? 'draft' : value.action === 'schedule' ? 'scheduled' : 'publishing',
    scheduledFor: value.action === 'schedule' ? value.scheduledFor : undefined,
    createdAt: now,
    updatedAt: now,
    results: {},
    attempts: 0
  };
  await upsertPost(post);
  if (value.action === 'publish') {
    const published = await publishPostById(post.id);
    return res.status(201).json(published);
  }
  res.status(201).json(post);
});

postsRouter.post('/:id/publish', async (req, res) => {
  try {
    const post = await publishPostById(req.params.id);
    res.json(post);
  } catch (error: any) {
    res.status(400).json({ error: error?.message || String(error) });
  }
});

postsRouter.post('/:id/retry', async (req, res) => {
  await updatePost(req.params.id, { status: 'scheduled', scheduledFor: new Date().toISOString() });
  const post = await publishPostById(req.params.id);
  res.json(post);
});
