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

const facebookScopes = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];

const instagramScopes = ['instagram_business_basic', 'instagram_business_content_publish'];

function facebookClientId(env: Env) {
  return env.FACEBOOK_APP_ID || env.META_APP_ID || '';
}

function facebookClientSecret(env: Env) {
  return env.FACEBOOK_APP_SECRET || env.META_APP_SECRET || '';
}

function instagramClientId(env: Env) {
  if (!env.INSTAGRAM_APP_ID) throw new AppError('Instagram App ID is not configured.', 503);
  return env.INSTAGRAM_APP_ID;
}

function instagramClientSecret(env: Env) {
  if (!env.INSTAGRAM_APP_SECRET) throw new AppError('Instagram App Secret is not configured.', 503);
  return env.INSTAGRAM_APP_SECRET;
}

export const facebookGraph = (env: Env, path: string) =>
  `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`;

export const instagramGraph = (env: Env, path: string) =>
  `https://graph.instagram.com/${env.META_GRAPH_VERSION}/${path}`;

// Backwards-compatible alias used by older helpers.
export const graph = facebookGraph;

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

export async function instagramToken(env: Env, user: string): Promise<string> {
  const old = await getCredential(env, user, 'instagram');
  if (!old?.value?.accessToken) throw new AppError('Connect Instagram first.');
  const expiry = Number(old.value.expiryDate || 0);
  if (!expiry || expiry > Date.now() + 7 * 86400000) return old.value.accessToken;

  try {
    const refreshed = await providerJson(
      `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
        grant_type: 'ig_refresh_token',
        access_token: old.value.accessToken,
      })}`,
    );
    const value = {
      ...old.value,
      accessToken: refreshed.access_token,
      expiryDate: Date.now() + Number(refreshed.expires_in || 5184000) * 1000,
      refreshedAt: now(),
    };
    await saveCredential(env, user, 'instagram', value);
    return value.accessToken;
  } catch (error) {
    if (expiry > Date.now() + 60000) return old.value.accessToken;
    throw new AppError('Instagram authorization expired. Reconnect Instagram.');
  }
}

function requiredCredentials(env: Env, provider: string) {
  if (provider === 'google') return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  if (provider === 'facebook') return !!(facebookClientId(env) && facebookClientSecret(env));
  if (provider === 'instagram') return !!(env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET);
  return false;
}

oauth.get('/:provider/start', async (c) => {
  const p = c.req.param('provider');
  if (!['google', 'facebook', 'instagram'].includes(p)) throw new AppError('Unknown provider.', 404);
  if (!requiredCredentials(c.env, p)) throw new AppError('Provider credentials are not configured.', 503);

  const { state } = await startState(c, p, c.get('user').id);
  const redirect_uri = `${c.env.APP_ORIGIN}/api/oauth/${p}/callback`;
  let url: string;

  if (p === 'google') {
    url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      redirect_uri,
      response_type: 'code',
      scope: googleScopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    })}`;
  } else if (p === 'facebook') {
    url = `https://www.facebook.com/${c.env.META_GRAPH_VERSION}/dialog/oauth?${new URLSearchParams({
      client_id: facebookClientId(c.env),
      redirect_uri,
      response_type: 'code',
      scope: facebookScopes.join(','),
      auth_type: 'rerequest',
      state,
    })}`;
  } else {
    url = `https://www.instagram.com/oauth/authorize?${new URLSearchParams({
      client_id: instagramClientId(c.env),
      redirect_uri,
      response_type: 'code',
      scope: instagramScopes.join(','),
      state,
    })}`;
  }

  return c.redirect(url);
});

oauth.get('/:provider/callback', async (c) => {
  const p = c.req.param('provider');
  try {
    if (!['google', 'facebook', 'instagram'].includes(p)) throw new AppError('Unknown provider.');
    const state = await consumeState(c, p);
    const user = c.get('user').id;
    const code = c.req.query('code');
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
    } else if (p === 'facebook') {
      const clientId = facebookClientId(c.env);
      const clientSecret = facebookClientSecret(c.env);
      const short = await providerJson(
        `${facebookGraph(c.env, 'oauth/access_token')}?${new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri,
        })}`,
      );
      let userAccessToken = short.access_token;
      try {
        const long = await providerJson(
          `${facebookGraph(c.env, 'oauth/access_token')}?${new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'fb_exchange_token',
            fb_exchange_token: short.access_token,
          })}`,
        );
        userAccessToken = long.access_token;
      } catch {
        // A short-lived token is still sufficient for an immediate development connection.
      }

      const headers = { Authorization: `Bearer ${userAccessToken}` };
      const permissions = await providerJson(facebookGraph(c.env, 'me/permissions'), { headers });
      const granted = new Set(
        permissions.data?.filter((x: any) => x.status === 'granted').map((x: any) => x.permission),
      );
      const missing = facebookScopes.filter((scope) => !granted.has(scope));
      if (missing.length)
        throw new AppError(`Required Facebook permissions were not granted: ${missing.join(', ')}.`);

      let pages: any[] = [];
      let next: string | undefined =
        `${facebookGraph(c.env, 'me/accounts')}?fields=id,name,access_token,tasks`;
      for (let i = 0; next && i < 20; i++) {
        const result = await providerJson(next, { headers });
        pages.push(...(result.data || []));
        next = result.paging?.next;
        if (next && new URL(next).hostname !== 'graph.facebook.com')
          throw new AppError('Unexpected Facebook pagination URL.');
      }
      const eligible = pages.filter(
        (x) => !x.tasks || x.tasks.includes('CREATE_CONTENT') || x.tasks.includes('MANAGE'),
      );
      const page = c.env.META_PAGE_ID ? eligible.find((x) => x.id === c.env.META_PAGE_ID) : eligible[0];
      if (!page)
        throw new AppError('No eligible Facebook Page found. Check META_PAGE_ID and Page permissions.');

      await saveCredential(c.env, user, 'facebook', {
        userAccessToken,
        pageAccessToken: page.access_token,
        pageId: page.id,
        pageName: page.name,
      });
      await account(c.env, user, 'facebook', {
        platform: 'facebook',
        connected: true,
        accountId: page.id,
        displayName: page.name,
        detail: 'Facebook Page · independent Facebook authorization',
        connectedAt: now(),
      });
    } else {
      const short = await providerJson('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: instagramClientId(c.env),
          client_secret: instagramClientSecret(c.env),
          grant_type: 'authorization_code',
          redirect_uri,
          code,
        }),
      });
      const long = await providerJson(
        `https://graph.instagram.com/access_token?${new URLSearchParams({
          grant_type: 'ig_exchange_token',
          client_secret: instagramClientSecret(c.env),
          access_token: short.access_token,
        })}`,
      );
      const accessToken = long.access_token || short.access_token;
      const profileResult = await providerJson(
        `${instagramGraph(c.env, 'me')}?${new URLSearchParams({ fields: 'user_id,username,name' })}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const profile = profileResult.data?.[0] || profileResult;
      const instagramUserId = String(profile.user_id || profile.id || short.user_id || '');
      if (!instagramUserId) throw new AppError('Instagram returned no Professional account ID.');

      await saveCredential(c.env, user, 'instagram', {
        accessToken,
        userId: instagramUserId,
        username: profile.username,
        expiryDate: long.expires_in
          ? Date.now() + Number(long.expires_in) * 1000
          : Date.now() + 3600000,
        connectedAt: now(),
      });
      await account(c.env, user, 'instagram', {
        platform: 'instagram',
        connected: true,
        accountId: instagramUserId,
        displayName: profile.username ? `@${profile.username}` : profile.name || 'Instagram',
        detail: 'Instagram Professional account · direct Instagram Login',
        connectedAt: now(),
      });
    }

    return c.redirect(`${c.env.APP_ORIGIN}/accounts?connected=${p === 'google' ? 'youtube' : p}`);
  } catch (error) {
    return c.redirect(
      `${c.env.APP_ORIGIN}/accounts?error=${encodeURIComponent(
        error instanceof AppError ? error.message : 'Could not connect provider. Try again.',
      )}`,
    );
  }
});

oauth.post('/:provider/disconnect', async (c) => {
  const p = c.req.param('provider');
  if (!['google', 'facebook', 'instagram'].includes(p)) throw new AppError('Unknown provider.', 404);
  const user = c.get('user').id;
  const platform = p === 'google' ? 'youtube' : p;
  const statements = [
    c.env.DB.prepare('DELETE FROM credentials WHERE user_id=? AND provider=?').bind(user, p),
    c.env.DB.prepare('DELETE FROM accounts WHERE user_id=? AND platform=?').bind(user, platform),
  ];
  if (p === 'facebook') {
    statements.push(
      c.env.DB.prepare('DELETE FROM credentials WHERE user_id=? AND provider=?').bind(user, 'meta'),
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});
