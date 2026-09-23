import { config, requireEnv } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { loadSecrets, mutateSecrets } from '../lib/secrets.js';
import { mutateDb } from '../lib/store.js';

export const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'publish_video',
  'instagram_basic',
  'instagram_content_publish'
];

const graph = (path: string) => `https://graph.facebook.com/${config.metaGraphVersion}/${path.replace(/^\//, '')}`;

function form(data: Record<string, string | number | boolean | undefined>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) body.set(key, String(value));
  }
  return body;
}

export function metaLoginUrl(state: string) {
  const params = new URLSearchParams({
    client_id: requireEnv('metaAppId'),
    redirect_uri: config.metaRedirectUri,
    state,
    response_type: 'code',
    scope: META_SCOPES.join(',')
  });
  return `https://www.facebook.com/${config.metaGraphVersion}/dialog/oauth?${params.toString()}`;
}

export async function exchangeMetaCode(code: string) {
  const short = await fetchJson<{ access_token: string }>(`${graph('/oauth/access_token')}?${new URLSearchParams({
    client_id: requireEnv('metaAppId'),
    client_secret: requireEnv('metaAppSecret'),
    redirect_uri: config.metaRedirectUri,
    code
  })}`);

  let userAccessToken = short.access_token;
  try {
    const long = await fetchJson<{ access_token: string }>(`${graph('/oauth/access_token')}?${new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: requireEnv('metaAppId'),
      client_secret: requireEnv('metaAppSecret'),
      fb_exchange_token: short.access_token
    })}`);
    userAccessToken = long.access_token;
  } catch (error) {
    console.warn('Meta long-lived token exchange did not succeed; keeping short-lived token:', error);
  }

  type Page = {
    id: string;
    name: string;
    access_token: string;
    tasks?: string[];
    instagram_business_account?: { id: string; username?: string };
  };
  const pageList = await fetchJson<{ data: Page[] }>(`${graph('/me/accounts')}?${new URLSearchParams({
    fields: 'id,name,access_token,tasks,instagram_business_account{id,username}',
    access_token: userAccessToken
  })}`);

  const eligible = pageList.data.filter((p) => !p.tasks || p.tasks.includes('CREATE_CONTENT') || p.tasks.includes('MANAGE'));
  const page = (config.metaPageId ? eligible.find((p) => p.id === config.metaPageId) : undefined) || eligible[0];
  if (!page) throw new Error('No Facebook Page with content-creation access was returned by Meta.');

  let ig = page.instagram_business_account;
  if (!ig) {
    try {
      const detail = await fetchJson<{ instagram_business_account?: { id: string; username?: string } }>(`${graph(`/${page.id}`)}?${new URLSearchParams({
        fields: 'instagram_business_account{id,username}',
        access_token: page.access_token
      })}`);
      ig = detail.instagram_business_account;
    } catch {}
  }

  await mutateSecrets((secrets) => {
    secrets.meta = {
      userAccessToken,
      pageAccessToken: page.access_token,
      pageId: page.id,
      pageName: page.name,
      instagramBusinessId: ig?.id,
      instagramUsername: ig?.username
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
    db.accounts.instagram = ig?.id ? {
      platform: 'instagram',
      connected: true,
      displayName: ig.username ? `@${ig.username}` : 'Instagram Professional account',
      accountId: ig.id,
      secondaryId: page.id,
      detail: 'Linked to Facebook Page',
      connectedAt: new Date().toISOString()
    } : {
      platform: 'instagram',
      connected: false,
      detail: 'Connect a Professional Instagram account to this Page in Meta.'
    };
  });
}

async function metaSecrets() {
  const secrets = await loadSecrets();
  if (!secrets.meta?.pageAccessToken || !secrets.meta.pageId) {
    throw new Error('Facebook is not connected. Open Connected Accounts and connect Meta first.');
  }
  return secrets.meta;
}

async function waitForInstagramContainer(containerId: string, token: string) {
  for (let attempt = 0; attempt < 75; attempt++) {
    const status = await fetchJson<{ status_code?: string; status?: string }>(`${graph(`/${containerId}`)}?${new URLSearchParams({
      fields: 'status_code,status',
      access_token: token
    })}`);
    const code = status.status_code || status.status;
    if (code === 'FINISHED' || code === 'PUBLISHED') return;
    if (code === 'ERROR' || code === 'EXPIRED') throw new Error(`Instagram media processing failed (${code}).`);
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  throw new Error('Instagram media processing timed out. Try publishing again in a few minutes.');
}

export async function publishInstagram(input: {
  mediaUrl: string;
  mimeType: string;
  caption: string;
}) {
  const meta = await metaSecrets();
  const igId = meta.instagramBusinessId;
  if (!igId) throw new Error('No Instagram Professional account is linked to the connected Facebook Page.');

  const isVideo = input.mimeType.startsWith('video/');
  const createBody = form({
    ...(isVideo
      ? { media_type: 'REELS', video_url: input.mediaUrl, share_to_feed: true }
      : { image_url: input.mediaUrl }),
    caption: input.caption.slice(0, 2200),
    access_token: meta.userAccessToken
  });

  const created = await fetchJson<{ id: string }>(graph(`/${igId}/media`), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: createBody
  });

  await waitForInstagramContainer(created.id, meta.userAccessToken);
  const published = await fetchJson<{ id: string }>(graph(`/${igId}/media_publish`), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ creation_id: created.id, access_token: meta.userAccessToken })
  });
  return { id: published.id };
}

export async function publishFacebook(input: {
  mediaUrl: string;
  mimeType: string;
  title: string;
  caption: string;
}) {
  const meta = await metaSecrets();
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

  // Page video publishing supports a hosted file URL. This is intentionally the
  // standard Page video endpoint because it is simpler and more stable than the
  // multi-step Reels upload flow while still publishing the same video to the Page.
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

export async function disconnectMeta() {
  await mutateSecrets((secrets) => { delete secrets.meta; });
  await mutateDb((db) => {
    db.accounts.facebook = { platform: 'facebook', connected: false };
    db.accounts.instagram = { platform: 'instagram', connected: false };
  });
}
