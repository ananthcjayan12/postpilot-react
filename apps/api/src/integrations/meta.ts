import { config, requireEnv } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { loadSecrets, mutateSecrets } from '../lib/secrets.js';
import { mutateDb } from '../lib/store.js';

export const FACEBOOK_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts'
];

const graph = (path: string) => `https://graph.facebook.com/${config.metaGraphVersion}/${path.replace(/^\//, '')}`;

function form(data: Record<string, string | number | boolean | undefined>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) body.set(key, String(value));
  }
  return body;
}

export function facebookLoginUrl(state: string) {
  const params = new URLSearchParams({
    client_id: requireEnv('facebookAppId'),
    redirect_uri: config.facebookRedirectUri,
    state,
    response_type: 'code',
    auth_type: 'rerequest',
    scope: FACEBOOK_SCOPES.join(',')
  });
  return `https://www.facebook.com/${config.metaGraphVersion}/dialog/oauth?${params.toString()}`;
}

async function assertGrantedFacebookPermissions(userAccessToken: string) {
  const response = await fetchJson<{ data?: Array<{ permission: string; status: string }> }>(
    `${graph('/me/permissions')}?${new URLSearchParams({ access_token: userAccessToken })}`
  );
  const granted = new Set(
    (response.data || [])
      .filter((item) => item.status === 'granted')
      .map((item) => item.permission)
  );
  const missing = FACEBOOK_SCOPES.filter((permission) => !granted.has(permission));
  if (missing.length) {
    throw new Error(
      `Facebook did not grant the required permissions: ${missing.join(', ')}. ` +
      'Make sure the Page permissions are Ready for testing, then reconnect.'
    );
  }
}

export async function exchangeFacebookCode(code: string) {
  const short = await fetchJson<{ access_token: string }>(`${graph('/oauth/access_token')}?${new URLSearchParams({
    client_id: requireEnv('facebookAppId'),
    client_secret: requireEnv('facebookAppSecret'),
    redirect_uri: config.facebookRedirectUri,
    code
  })}`);

  let userAccessToken = short.access_token;
  try {
    const long = await fetchJson<{ access_token: string }>(`${graph('/oauth/access_token')}?${new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: requireEnv('facebookAppId'),
      client_secret: requireEnv('facebookAppSecret'),
      fb_exchange_token: short.access_token
    })}`);
    userAccessToken = long.access_token;
  } catch (error) {
    console.warn('Meta long-lived token exchange did not succeed; keeping short-lived token:', error);
  }

  await assertGrantedFacebookPermissions(userAccessToken);

  type Page = {
    id: string;
    name: string;
    access_token: string;
    tasks?: string[];
  };
  const pageList = await fetchJson<{ data: Page[] }>(`${graph('/me/accounts')}?${new URLSearchParams({
    fields: 'id,name,access_token,tasks',
    access_token: userAccessToken
  })}`);

  const eligible = pageList.data.filter((p) => !p.tasks || p.tasks.includes('CREATE_CONTENT') || p.tasks.includes('MANAGE'));
  const page = (config.metaPageId ? eligible.find((p) => p.id === config.metaPageId) : undefined) || eligible[0];
  if (!page) throw new Error('No Facebook Page with content-creation access was returned by Meta.');

  await mutateSecrets((secrets) => {
    secrets.facebook = {
      userAccessToken,
      pageAccessToken: page.access_token,
      pageId: page.id,
      pageName: page.name
    };
  });

  await mutateDb((db) => {
    db.accounts.facebook = {
      platform: 'facebook',
      connected: true,
      displayName: page.name,
      accountId: page.id,
      detail: 'Facebook Page',
      connectedAt: new Date().toISOString()
    };
  });
}

async function facebookSecrets() {
  const secrets = await loadSecrets();
  const grant = secrets.facebook || secrets.meta;
  if (!grant?.pageAccessToken || !grant.pageId) {
    throw new Error('Facebook is not connected. Open Connected Accounts and connect Facebook first.');
  }
  return grant;
}

export async function publishFacebook(input: {
  mediaUrl: string;
  mimeType: string;
  title: string;
  caption: string;
}) {
  const meta = await facebookSecrets();
  if (input.mimeType.startsWith('image/')) {
    const published = await fetchJson<{ id: string; post_id?: string }>(graph(`/${meta.pageId}/photos`), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({
        url: input.mediaUrl,
        caption: input.caption,
        published: true,
        access_token: meta.pageAccessToken
      })
    });
    return { id: published.post_id || published.id, url: `https://www.facebook.com/${published.post_id || published.id}` };
  }

  // Page video publishing uses pages_manage_posts. PostPilot intentionally does
  // not request the legacy publish_video permission for this publishing flow.
  const published = await fetchJson<{ id: string }>(graph(`/${meta.pageId}/videos`), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({
      file_url: input.mediaUrl,
      title: input.title.slice(0, 255),
      description: input.caption,
      published: true,
      access_token: meta.pageAccessToken
    })
  });
  return { id: published.id, url: `https://www.facebook.com/${published.id}` };
}

export async function disconnectFacebook() {
  await mutateSecrets((secrets) => { delete secrets.facebook; });
  await mutateDb((db) => {
    db.accounts.facebook = { platform: 'facebook', connected: false };
  });
}
