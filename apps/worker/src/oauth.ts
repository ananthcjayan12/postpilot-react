import { Hono } from 'hono';
import type { AppEnv, Env } from './env';
import { requireSession, startState, consumeState } from './auth';
import { AppError, providerJson, getCredential, saveCredential, now, seal } from './lib';
export const oauth = new Hono<AppEnv>();
oauth.use('*', requireSession);
const googleScopes = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];
const metaScopes = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
];
export const graph = (env: Env, path: string) =>
  `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`;
export async function account(env: Env, user: string, platform: string, data: unknown) {
  await env.DB.prepare(
    'INSERT INTO accounts(user_id,platform,data) VALUES(?,?,?) ON CONFLICT(user_id,platform) DO UPDATE SET data=excluded.data',
  )
    .bind(user, platform, JSON.stringify(data))
    .run();
}
export async function googleToken(env: Env, user: string): Promise<string> {
  const old = await getCredential(env, user, 'google');
  if (!old) throw new AppError('Connect YouTube first.');
  if (old.value.expiryDate > Date.now() + 60000 && old.value.accessToken) return old.value.accessToken;
  if (!old.value.refreshToken) throw new AppError('Reconnect YouTube to renew authorization.');
  const t = await providerJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: old.value.refreshToken,
    }),
  });
  const value = {
    accessToken: t.access_token,
    refreshToken: t.refresh_token || old.value.refreshToken,
    expiryDate: Date.now() + t.expires_in * 1000,
  };
  const result = await env.DB.prepare(
    'UPDATE credentials SET envelope=?,version=version+1 WHERE user_id=? AND provider=? AND version=?',
  )
    .bind(await seal(env, value, `${user}:google`), user, 'google', old.version)
    .run();
  if (!result.meta.changes) {
    const current = await getCredential(env, user, 'google');
    if (!current) throw new AppError('YouTube was disconnected.');
    return current.value.accessToken;
  }
  return value.accessToken;
}
oauth.get('/:provider/start', async (c) => {
  const p = c.req.param('provider');
  if (!['google', 'meta'].includes(p)) throw new AppError('Unknown provider.', 404);
  if (
    (p === 'google' && (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET)) ||
    (p === 'meta' && (!c.env.META_APP_ID || !c.env.META_APP_SECRET))
  )
    throw new AppError('Provider credentials are not configured.', 503);
  const { state } = await startState(c, p, c.get('user').id);
  const redirect_uri = `${c.env.APP_ORIGIN}/api/oauth/${p}/callback`;
  const url =
    p === 'google'
      ? `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: c.env.GOOGLE_CLIENT_ID, redirect_uri, response_type: 'code', scope: googleScopes.join(' '), access_type: 'offline', prompt: 'consent', state })}`
      : `https://www.facebook.com/${c.env.META_GRAPH_VERSION}/dialog/oauth?${new URLSearchParams({ client_id: c.env.META_APP_ID, redirect_uri, response_type: 'code', scope: metaScopes.join(','), auth_type: 'rerequest', state })}`;
  return c.redirect(url);
});
oauth.get('/:provider/callback', async (c) => {
  const p = c.req.param('provider');
  try {
    if (!['google', 'meta'].includes(p)) throw new AppError('Unknown provider.');
    const state = await consumeState(c, p),
      user = c.get('user').id,
      code = c.req.query('code');
    if (state.user_id !== user || !code) throw new AppError('Authorization was not completed by this user.');
    const redirect_uri = `${c.env.APP_ORIGIN}/api/oauth/${p}/callback`;
    if (p === 'google') {
      const t = await providerJson('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: c.env.GOOGLE_CLIENT_ID,
          client_secret: c.env.GOOGLE_CLIENT_SECRET,
          code,
          redirect_uri,
          grant_type: 'authorization_code',
        }),
      });
      const channel = await providerJson(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        { headers: { Authorization: `Bearer ${t.access_token}` } },
      );
      const ch = channel.items?.[0];
      if (!ch) throw new AppError('No YouTube channel was returned for this account.');
      const old = await getCredential(c.env, user, p);
      await saveCredential(c.env, user, p, {
        accessToken: t.access_token,
        refreshToken: t.refresh_token || old?.value.refreshToken,
        expiryDate: Date.now() + t.expires_in * 1000,
      });
      await account(c.env, user, 'youtube', {
        platform: 'youtube',
        connected: true,
        accountId: ch.id,
        displayName: ch.snippet.title,
        connectedAt: now(),
      });
    } else {
      const short = await providerJson(
        `${graph(c.env, 'oauth/access_token')}?${new URLSearchParams({ client_id: c.env.META_APP_ID, client_secret: c.env.META_APP_SECRET, code, redirect_uri })}`,
      );
      const long = await providerJson(
        `${graph(c.env, 'oauth/access_token')}?${new URLSearchParams({ client_id: c.env.META_APP_ID, client_secret: c.env.META_APP_SECRET, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token })}`,
      );
      const headers = { Authorization: `Bearer ${long.access_token}` };
      const permissions = await providerJson(graph(c.env, 'me/permissions'), { headers });
      const granted = new Set(
        permissions.data?.filter((x: any) => x.status === 'granted').map((x: any) => x.permission),
      );
      if (metaScopes.some((s) => !granted.has(s)))
        throw new AppError(
          'Required Meta permissions were not granted. Configure permissions and reconnect.',
        );
      let pages: any[] = [];
      let url: string | undefined =
        `${graph(c.env, 'me/accounts')}?fields=id,name,access_token,tasks,instagram_business_account{id,username}`;
      for (let i = 0; url && i < 20; i++) {
        const result = await providerJson(url, { headers });
        pages.push(...result.data);
        url = result.paging?.next;
        if (url && new URL(url).hostname !== 'graph.facebook.com')
          throw new AppError('Unexpected provider pagination URL.');
      }
      const eligible = pages.filter(
        (x) => !x.tasks || x.tasks.includes('CREATE_CONTENT') || x.tasks.includes('MANAGE'),
      );
      const page = c.env.META_PAGE_ID ? eligible.find((x) => x.id === c.env.META_PAGE_ID) : eligible[0];
      if (!page)
        throw new AppError('No eligible Facebook Page found. Check META_PAGE_ID and Page permissions.');
      const ig = page.instagram_business_account;
      await saveCredential(c.env, user, p, {
        userAccessToken: long.access_token,
        pageAccessToken: page.access_token,
        pageId: page.id,
        instagramBusinessId: ig?.id,
      });
      await account(c.env, user, 'facebook', {
        platform: 'facebook',
        connected: true,
        accountId: page.id,
        displayName: page.name,
        connectedAt: now(),
      });
      await account(
        c.env,
        user,
        'instagram',
        ig
          ? {
              platform: 'instagram',
              connected: true,
              accountId: ig.id,
              displayName: ig.username || 'Instagram',
              connectedAt: now(),
            }
          : { platform: 'instagram', connected: false },
      );
    }
    return c.redirect(`${c.env.APP_ORIGIN}/accounts?connected=${p === 'google' ? 'youtube' : 'meta'}`);
  } catch (error) {
    return c.redirect(
      `${c.env.APP_ORIGIN}/accounts?error=${encodeURIComponent(error instanceof AppError ? error.message : 'Could not connect provider. Try again.')}`,
    );
  }
});
oauth.post('/:provider/disconnect', async (c) => {
  const p = c.req.param('provider');
  if (!['google', 'meta'].includes(p)) throw new AppError('Unknown provider.', 404);
  const user = c.get('user').id;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM credentials WHERE user_id=? AND provider=?').bind(user, p),
    c.env.DB.prepare(
      `DELETE FROM accounts WHERE user_id=? AND platform IN (${p === 'google' ? "'youtube'" : "'instagram','facebook'"})`,
    ).bind(user),
  ]);
  return c.json({ ok: true });
});
