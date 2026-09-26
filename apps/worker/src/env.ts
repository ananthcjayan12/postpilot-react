export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  PUBLISH: Workflow<{ runId: string }>;
  APP_ORIGIN: string;
  APP_ENCRYPTION_KEY: string;
  ALLOWED_OWNER_EMAIL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  FACEBOOK_APP_ID?: string;
  FACEBOOK_APP_SECRET?: string;
  INSTAGRAM_APP_ID?: string;
  INSTAGRAM_APP_SECRET?: string;
  META_GRAPH_VERSION: string;
  META_PAGE_ID?: string;
  LOCAL_UPLOADS?: string;
  STORAGE_QUOTA_BYTES?: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
}
export type Variables = { user: { id: string; email: string; name: string }; csrf: string };
export type AppEnv = { Bindings: Env; Variables: Variables };
export type PostRow = {
  id: string;
  user_id: string;
  media_id: string;
  title: string;
  caption: string;
  status: string;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
  attempts: number;
  last_error: string | null;
  hashtags: string | null;
  thumbnail_media_id: string | null;
};
export type MediaRow = {
  id: string;
  user_id: string;
  object_key: string;
  name: string;
  mime: string;
  size: number;
  created_at: string;
};
export type Target = {
  post_id: string;
  platform: string;
  status: string;
  data: string;
  error: string | null;
};
