import { Router } from 'express';
import { loadDb } from '../lib/store.js';

export const analyticsRouter = Router();

analyticsRouter.get('/', async (_req, res) => {
  const db = await loadDb();
  const counts = { draft: 0, scheduled: 0, publishing: 0, published: 0, partial: 0, failed: 0 } as Record<string, number>;
  for (const post of db.posts) counts[post.status] = (counts[post.status] || 0) + 1;
  const platforms = { youtube: 0, instagram: 0, facebook: 0 };
  for (const post of db.posts) {
    for (const platform of post.platforms) platforms[platform] += 1;
  }
  const recent = [...db.posts]
    .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
    .slice(-14)
    .map((p) => ({ date: p.createdAt.slice(0, 10), published: p.status === 'published' ? 1 : 0, scheduled: p.status === 'scheduled' ? 1 : 0 }));
  res.json({ total: db.posts.length, counts, platforms, recent });
});
