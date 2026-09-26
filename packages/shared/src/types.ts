export type Platform = 'youtube' | 'instagram' | 'facebook';
export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed';

export interface MediaAsset {
  id: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  localUrl: string;
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
  youtubeFormat?: 'video' | 'short';
  hashtags?: string;
  thumbnailMediaId?: string;
  targetStatuses: Partial<Record<Platform, 'pending' | 'uploading' | 'processing' | 'sending' | 'success' | 'failed' | 'review' | 'deleted'>>;
}

export interface AccountInfo {
  platform: Platform;
  connected: boolean;
  displayName?: string;
  accountId?: string;
  secondaryId?: string;
  connectedAt?: string;
  detail?: string;
}

export interface AccountsResponse {
  accounts: Record<Platform, AccountInfo>;
  readiness: {
    googleConfigured: boolean;
    facebookConfigured: boolean;
    instagramConfigured: boolean;
    publicMediaUrlConfigured: boolean;
    publicBaseUrl: string | null;
  };
}
