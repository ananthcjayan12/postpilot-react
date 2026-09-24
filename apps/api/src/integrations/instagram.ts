import { config, requireEnv } from '../config.js';
import { fetchJson } from '../lib/http.js';
import { loadSecrets, mutateSecrets } from '../lib/secrets.js';
import { mutateDb } from '../lib/store.js';

export const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish'
];

const graph = (path: string) =>
  `https://graph.instagram.com/${config.metaGraphVersion}/${path.replace(/^\//, '')}`;

function form(data: Record<string, string | number | boolean | undefined>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) body.set(key, String(value));
  }
  return body;
}

export function instagramLoginUrl(state: string) {
  const params = new URLSearchParams({
    client_id: requireEnv('instagramAppId'),
    redirect_uri: config.instagramRedirectUri,
    state,
    response_type: 'code',
    scope: INSTAGRAM_SCOPES.join(',')
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeInstagramCode(code: string) {
  const short = await fetchJson<{
    access_token: string;
    user_id?: string | number;
  }>('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({
      client_id: requireEnv('instagramAppId'),
      client_secret: requireEnv('instagramAppSecret'),
      grant_type: 'authorization_code',
      redirect_uri: config.instagramRedirectUri,
      code
    })
  });

  const long = await fetchJson<{ access_token: string; expires_in?: number }>(
    `https://graph.instagram.com/access_token?${new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: requireEnv('instagramAppSecret'),
      access_token: short.access_token
    })}`
  );

  const accessToken = long.access_token || short.access_token;
  const profileResult = await fetchJson<any>(
    `${graph('/me')}?${new URLSearchParams({ fields: 'user_id,username,name' })}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const profile = profileResult.data?.[0] || profileResult;
  const userId = String(profile.user_id || profile.id || short.user_id || '');
  if (!userId) throw new Error('Instagram returned no Professional account ID.');

  await mutateSecrets((secrets) => {
    secrets.instagram = {
      accessToken,
      userId,
      username: profile.username,
      expiryDate: Date.now() + Number(long.expires_in || 3600) * 1000,
      connectedAt: new Date().toISOString()
    };
  });

  await mutateDb((db) => {
    db.accounts.instagram = {
      platform: 'instagram',
      connected: true,
      displayName: profile.username ? `@${profile.username}` : profile.name || 'Instagram',
      accountId: userId,
      detail: 'Instagram Professional account · direct Instagram Login',
      connectedAt: new Date().toISOString()
    };
  });
}

async function instagramGrant() {
  const secrets = await loadSecrets();
  const grant = secrets.instagram;
  if (!grant?.accessToken || !grant.userId) {
    throw new Error('Instagram is not connected. Open Connected Accounts and connect Instagram first.');
  }

  if (grant.expiryDate && grant.expiryDate <= Date.now() + 7 * 86400000) {
    try {
      const refreshed = await fetchJson<{ access_token: string; expires_in?: number }>(
        `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
          grant_type: 'ig_refresh_token',
          access_token: grant.accessToken
        })}`
      );
      const updated = {
        ...grant,
        accessToken: refreshed.access_token,
        expiryDate: Date.now() + Number(refreshed.expires_in || 5184000) * 1000
      };
      await mutateSecrets((current) => {
        current.instagram = updated;
      });
      return updated;
    } catch {
      if (grant.expiryDate <= Date.now()) {
        throw new Error('Instagram authorization expired. Reconnect Instagram.');
      }
    }
  }

  return grant;
}

async function waitForContainer(containerId: string, token: string) {
  for (let attempt = 0; attempt < 75; attempt++) {
    const status = await fetchJson<{ status_code?: string; status?: string }>(
      `${graph(`/${containerId}`)}?${new URLSearchParams({ fields: 'status_code,status' })}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const code = status.status_code || status.status;
    if (code === 'FINISHED' || code === 'PUBLISHED') return;
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new Error(`Instagram media processing failed (${code}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  throw new Error('Instagram media processing timed out. Try publishing again in a few minutes.');
}

export async function publishInstagram(input: {
  mediaUrl: string;
  mimeType: string;
  caption: string;
}) {
  const grant = await instagramGrant();
  const createBody = form({
    ...(input.mimeType.startsWith('video/')
      ? { media_type: 'REELS', video_url: input.mediaUrl, share_to_feed: true }
      : { image_url: input.mediaUrl }),
    caption: input.caption.slice(0, 2200)
  });

  const created = await fetchJson<{ id: string }>(graph(`/${grant.userId}/media`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${grant.accessToken}` },
    body: createBody
  });

  await waitForContainer(created.id, grant.accessToken);
  const published = await fetchJson<{ id: string }>(graph(`/${grant.userId}/media_publish`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${grant.accessToken}` },
    body: form({ creation_id: created.id })
  });
  return { id: published.id };
}

export async function disconnectInstagram() {
  await mutateSecrets((secrets) => {
    delete secrets.instagram;
  });
  await mutateDb((db) => {
    db.accounts.instagram = { platform: 'instagram', connected: false };
  });
}
