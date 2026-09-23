import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { config, uploadsDir } from './config.js';
import { mediaRouter } from './routes/media.js';
import { postsRouter } from './routes/posts.js';
import { oauthRouter } from './routes/oauth.js';
import { accountsRouter } from './routes/accounts.js';
import { analyticsRouter } from './routes/analytics.js';
import { getMedia } from './lib/store.js';
import { startScheduler } from './integrations/publisher.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/health', (_req, res) => res.json({ ok: true, service: 'postpilot-api' }));
app.use('/api/media', mediaRouter);
app.use('/api/posts', postsRouter);
app.use('/api/oauth', oauthRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/analytics', analyticsRouter);

app.get('/media-files/:id', async (req, res) => {
  const media = await getMedia(req.params.id);
  if (!media) return res.status(404).send('Media not found');
  res.type(media.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.resolve(uploadsDir, media.fileName));
});

app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: error?.message || 'Unexpected server error' });
});

app.listen(config.port, () => {
  console.log(`PostPilot API listening on ${config.apiOrigin}`);
  if (!config.publicBaseUrl) console.log('Meta publishing note: PUBLIC_BASE_URL is not configured yet.');
  startScheduler();
});
