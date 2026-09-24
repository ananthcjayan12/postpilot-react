import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const apiRoot = path.resolve(here, '..');
export const repoRoot = path.resolve(apiRoot, '../..');
dotenv.config({ path: path.resolve(repoRoot, '.env') });

export const dataDir = path.resolve(apiRoot, 'data');
export const uploadsDir = path.resolve(dataDir, 'uploads');

export const config = {
  port: Number(process.env.PORT || 8787),
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:5173',
  apiOrigin: process.env.API_ORIGIN || 'http://localhost:8787',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  encryptionKey: process.env.APP_ENCRYPTION_KEY || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8787/api/oauth/google/callback',
  facebookAppId: process.env.FACEBOOK_APP_ID || process.env.META_APP_ID || '',
  facebookAppSecret: process.env.FACEBOOK_APP_SECRET || process.env.META_APP_SECRET || '',
  facebookRedirectUri:
    process.env.FACEBOOK_REDIRECT_URI || 'http://localhost:8787/api/oauth/facebook/callback',
  instagramAppId: process.env.INSTAGRAM_APP_ID || '',
  instagramAppSecret: process.env.INSTAGRAM_APP_SECRET || '',
  instagramRedirectUri:
    process.env.INSTAGRAM_REDIRECT_URI || 'http://localhost:8787/api/oauth/instagram/callback',
  // Legacy aliases retained so existing Facebook deployments do not break immediately.
  metaAppId: process.env.META_APP_ID || '',
  metaAppSecret: process.env.META_APP_SECRET || '',
  metaRedirectUri: process.env.META_REDIRECT_URI || 'http://localhost:8787/api/oauth/meta/callback',
  metaGraphVersion: process.env.META_GRAPH_VERSION || 'v25.0',
  metaPageId: process.env.META_PAGE_ID || ''
};

export function requireEnv(name: keyof typeof config): string {
  const value = String(config[name] || '');
  if (!value) throw new Error(`Missing configuration: ${name}. Update the root .env file.`);
  return value;
}
