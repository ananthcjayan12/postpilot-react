export type Platform = 'youtube' | 'instagram' | 'facebook';
export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed';

export interface MediaAsset {
  id: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface PublishResult {
  ok: boolean;
  id?: string;
  url?: string;
  error?: string;
}

export interface PostRecord {
  id: string;
  title: string;
  caption: string;
  mediaId: string;
  platforms: Platform[];
  status: PostStatus;
  scheduledFor?: string;
  createdAt: string;
  updatedAt: string;
  results: Partial<Record<Platform, PublishResult>>;
  attempts: number;
  lastError?: string;
}

export interface ConnectedAccount {
  platform: Platform;
  connected: boolean;
  displayName?: string;
  accountId?: string;
  secondaryId?: string;
  connectedAt?: string;
  detail?: string;
}

export interface PublicAccountState {
  youtube: ConnectedAccount;
  instagram: ConnectedAccount;
  facebook: ConnectedAccount;
}

export interface DbShape {
  media: MediaAsset[];
  posts: PostRecord[];
  accounts: PublicAccountState;
  settings: {
    schedulerEnabled: boolean;
    defaultPlatforms: Platform[];
  };
}

export interface SecretShape {
  google?: {
    accessToken?: string;
    refreshToken?: string;
    expiryDate?: number;
  };
  facebook?: {
    userAccessToken: string;
    pageAccessToken: string;
    pageId: string;
    pageName?: string;
  };
  instagram?: {
    accessToken: string;
    userId: string;
    username?: string;
    expiryDate?: number;
    connectedAt?: string;
  };
  // Legacy combined Meta grant; Facebook publishing can still read this during migration.
  meta?: {
    userAccessToken: string;
    pageAccessToken: string;
    pageId: string;
    pageName?: string;
    instagramBusinessId?: string;
    instagramUsername?: string;
  };
}
