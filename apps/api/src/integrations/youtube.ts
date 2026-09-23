import { createReadStream } from 'node:fs';
import { google } from 'googleapis';
import { config, requireEnv } from '../config.js';
import { loadSecrets, mutateSecrets } from '../lib/secrets.js';
import { mutateDb } from '../lib/store.js';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly'
];

export function createGoogleOAuthClient() {
  const client = new google.auth.OAuth2(
    requireEnv('googleClientId'),
    requireEnv('googleClientSecret'),
    config.googleRedirectUri
  );
  client.on('tokens', (tokens) => {
    void mutateSecrets((secrets) => {
      secrets.google ||= {};
      if (tokens.access_token) secrets.google.accessToken = tokens.access_token;
      if (tokens.refresh_token) secrets.google.refreshToken = tokens.refresh_token;
      if (tokens.expiry_date) secrets.google.expiryDate = tokens.expiry_date;
    }).catch((error) => console.error('Could not persist refreshed Google token:', error));
  });
  return client;
}

export async function saveGoogleGrant(tokens: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
}) {
  const existing = await loadSecrets();
  await mutateSecrets((secrets) => {
    secrets.google = {
      accessToken: tokens.access_token || existing.google?.accessToken,
      refreshToken: tokens.refresh_token || existing.google?.refreshToken,
      expiryDate: tokens.expiry_date || existing.google?.expiryDate
    };
  });

  const auth = await authorizedGoogleClient();
  const youtube = google.youtube({ version: 'v3', auth });
  const channel = await youtube.channels.list({ part: ['snippet'], mine: true });
  const item = channel.data.items?.[0];
  await mutateDb((db) => {
    db.accounts.youtube = {
      platform: 'youtube',
      connected: true,
      accountId: item?.id || undefined,
      displayName: item?.snippet?.title || 'YouTube channel',
      detail: item?.snippet?.customUrl || undefined,
      connectedAt: new Date().toISOString()
    };
  });
}

export async function authorizedGoogleClient() {
  const secrets = await loadSecrets();
  if (!secrets.google?.refreshToken && !secrets.google?.accessToken) {
    throw new Error('YouTube is not connected. Open Connected Accounts and connect YouTube first.');
  }
  const client = createGoogleOAuthClient();
  client.setCredentials({
    access_token: secrets.google.accessToken,
    refresh_token: secrets.google.refreshToken,
    expiry_date: secrets.google.expiryDate
  });
  return client;
}

export async function publishYouTube(input: {
  filePath: string;
  title: string;
  description: string;
}) {
  const auth = await authorizedGoogleClient();
  const youtube = google.youtube({ version: 'v3', auth });
  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: input.title.slice(0, 100),
        description: input.description.slice(0, 5000),
        categoryId: '22'
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false
      }
    },
    media: { body: createReadStream(input.filePath) }
  });
  const id = response.data.id;
  if (!id) throw new Error('YouTube accepted the request but returned no video ID.');
  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

export async function disconnectYouTube() {
  const secrets = await loadSecrets();
  const token = secrets.google?.accessToken || secrets.google?.refreshToken;
  if (token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
    } catch {}
  }
  await mutateSecrets((s) => { delete s.google; });
  await mutateDb((db) => {
    db.accounts.youtube = { platform: 'youtube', connected: false };
  });
}
