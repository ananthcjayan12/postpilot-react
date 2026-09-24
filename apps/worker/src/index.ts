import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ZodError } from 'zod';
import type { AppEnv, Env } from './env';
import { AppError } from './lib';
import { auth, requireSession } from './auth';
import { oauth } from './oauth';
import { media, mediaResponse, cleanupUploads } from './media';
import { api, dispatch } from './posts';
import { gemini } from './gemini';
export { PublishPost } from './publish';
export const app = new Hono<AppEnv>();
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 9 * 1024 * 1024,
    onError: (c) => c.json({ error: 'Request body is too large.' }, 413),
  }),
);
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store');
});
app.get('/health', (c) => c.json({ ok: true, service: 'postpilot-worker' }));
app.route('/api/auth', auth);
app.route('/api/oauth', oauth);
app.route('/api/media', media);
app.route('/api/ai', gemini);
app.route('/api', api);
app.on(['GET', 'HEAD'], '/media-files/:id', requireSession, (c) =>
  mediaResponse(c.req.raw, c.env, c.req.param('id')!, c.get('user').id),
);
app.on(['GET', 'HEAD'], '/media-delivery/:id', (c) => mediaResponse(c.req.raw, c.env, c.req.param('id')));
app.all('/api/*', (c) => c.json({ error: 'API route not found.' }, 404));
app.all('/media-files/*', (c) => c.json({ error: 'Media route not found.' }, 404));
app.all('/media-delivery/*', (c) => c.json({ error: 'Media route not found.' }, 404));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => {
  if (error instanceof ZodError) return c.json({ error: 'Invalid request.', details: error.flatten() }, 400);
  if (error instanceof AppError) return c.json({ error: error.message }, error.status as 400);
  console.error('Request failed', error.name);
  return c.json({ error: 'Unexpected server error.' }, 500);
});
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        await dispatch(env);
        await cleanupUploads(env);
        await env.DB.batch([
          env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()),
          env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<?').bind(Date.now()),
        ]);
      })(),
    );
  },
};
