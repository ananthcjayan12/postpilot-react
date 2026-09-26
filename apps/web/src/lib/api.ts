import type { thumbnailPeopleOptions } from '@postpilot/shared';
import type { AccountsResponse, MediaAsset, Platform, PostRecord } from './types';

let csrf = '';
export type Session = { user: { id: string; email: string; name: string }; csrf: string };
export type Settings = {
  youtube: boolean;
  instagram: boolean;
  facebook: boolean;
  confirm: boolean;
  notify: boolean;
  schedulerEnabled: boolean;
  thumbnailPeople: keyof typeof thumbnailPeopleOptions;
  geminiConfigured: boolean;
  openaiConfigured: boolean;
  aiRoutes: {
    metadata: 'gemini:gemini-3.8-flash' | 'gemini:gemini-2.5-flash';
    hashtags: 'gemini:gemini-3.8-flash' | 'gemini:gemini-2.5-flash' | 'openai:gpt-5-mini' | 'openai:gpt-4.1-mini';
    thumbnailCopy: 'gemini:gemini-3.8-flash' | 'gemini:gemini-2.5-flash' | 'openai:gpt-5-mini' | 'openai:gpt-4.1-mini';
    thumbnail: 'gemini:gemini-3.1-flash-image' | 'gemini:gemini-2.5-flash-image' | 'openai:gpt-image-2.5-flare' | 'openai:gpt-image-2.5-sunburst';
    thumbnailResolution: '1K' | '2K' | '4K';
  };
  contentLanguage: {
    mode: 'english' | 'malayalam' | 'malayalam_english' | 'custom';
    custom: string;
  };
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.method && !['GET', 'HEAD'].includes(init.method)) {
    if (!csrf) {
      const session = await request<Session>('/api/auth/session');
      csrf = session.csrf;
    }
    headers.set('X-CSRF-Token', csrf);
  }
  const response = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    if (response.status === 401 && !url.startsWith('/api/auth/')) location.assign('/login');
    const message =
      typeof body?.error === 'string'
        ? body.error
        : body?.error
          ? JSON.stringify(body.error)
          : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  session: async () => {
    const session = await request<Session>('/api/auth/session');
    csrf = session.csrf;
    return session;
  },
  logout: async () => {
    await request('/api/auth/logout', { method: 'POST' });
    csrf = '';
    location.assign('/login');
  },
  settings: () => request<Settings>('/api/settings'),
  saveSettings: (value: Settings & { geminiApiKey?: string | null; openaiApiKey?: string | null }) =>
    request<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    }),
  posts: () => request<PostRecord[]>('/api/posts'),
  suggestMetadata: (mediaId: string, youtubeFormat: 'video' | 'short') =>
    request<{ titles: string[]; description: string }>('/api/ai/suggest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId, youtubeFormat }),
    }),
  generateHashtags: (title: string, caption: string) =>
    request<{ hashtags: string; provider: string; model: string }>('/api/ai/hashtags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, caption }) }),
  generateThumbnailCopy: (title: string, caption: string, feedback?: string) =>
    request<{ thumbnailText: string; provider: string; model: string }>('/api/ai/thumbnail-copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, caption, feedback }) }),
  generateThumbnail: (title: string, caption: string, orientation: 'horizontal' | 'vertical', referenceMediaId?: string, thumbnailText?: string, referenceMode: 'preserve' | 'style' = 'style', preserveReferenceBranding = false) =>
    request<MediaAsset & { provider: string; model: string; thumbnailText: string; orientation: string }>('/api/ai/thumbnail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, caption, orientation, referenceMediaId, thumbnailText, referenceMode, preserveReferenceBranding }) }),
  media: () => request<MediaAsset[]>('/api/media'),
  deleteMedia: (id: string) => request<{ ok: true }>(`/api/media/${id}`, { method: 'DELETE' }),
  accounts: () => request<AccountsResponse>('/api/accounts'),
  analytics: () => request<any>('/api/analytics'),
  upload: async (file: File, progress?: (percentage: number) => void) => {
    const fingerprint = `pp-upload:${file.name}:${file.size}:${file.lastModified}`;
    let session: {
      id: string;
      partSize: number;
      parts: number;
      completed: { partNumber: number; etag: string }[];
      expires: number;
    } | null = null;
    try {
      session = JSON.parse(sessionStorage.getItem(fingerprint) || 'null');
    } catch {}
    if (!session || session.expires < Date.now()) {
      const created = await request<{ id: string; partSize: number; parts: number }>('/api/media/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
      });
      session = { ...created, completed: [], expires: Date.now() + 23 * 3600000 };
    }
    const persist = () => sessionStorage.setItem(fingerprint, JSON.stringify(session));
    persist();
    for (let partNumber = 1; partNumber <= session.parts; partNumber++) {
      if (session.completed.some((p) => p.partNumber === partNumber)) continue;
      let etag = '';
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const signed = await request<{ url: string; local: boolean }>(
            `/api/media/uploads/${session.id}/parts`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ partNumber }),
            },
          );
          const response = await fetch(signed.url, {
            method: 'PUT',
            headers: signed.local ? { 'X-CSRF-Token': csrf } : {},
            body: file.slice((partNumber - 1) * session.partSize, partNumber * session.partSize),
          });
          if (!response.ok) throw new Error(`Upload part failed (${response.status})`);
          etag = signed.local
            ? (await response.json()).etag
            : (response.headers.get('ETag') || '').replace(/^"|"$/g, '');
          if (!etag) throw new Error('R2 did not expose ETag. Check bucket CORS.');
          break;
        } catch (error) {
          if (attempt === 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        }
      }
      session.completed.push({ partNumber, etag });
      persist();
      progress?.(Math.round((session.completed.length / session.parts) * 100));
    }
    const asset = await request<MediaAsset>(`/api/media/uploads/${session.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: session.completed }),
    });
    sessionStorage.removeItem(fingerprint);
    return asset;
  },
  createPost: (input: {
    title: string;
    caption: string;
    mediaId: string;
    platforms: Platform[];
    action: 'draft' | 'schedule' | 'publish';
    scheduledFor?: string;
    youtubeFormat?: 'video' | 'short';
    videoMetadata?: { width: number; height: number; duration: number };
    hashtags?: string;
    thumbnailMediaId?: string | null;
  }) =>
    request<PostRecord>('/api/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  updatePost: (id: string, input: {
    title: string;
    caption: string;
    mediaId: string;
    platforms: Platform[];
    action: 'draft' | 'schedule';
    scheduledFor?: string;
    youtubeFormat?: 'video' | 'short';
    videoMetadata?: { width: number; height: number; duration: number };
    hashtags?: string;
    thumbnailMediaId?: string | null;
  }) => request<PostRecord>(`/api/posts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }),
  publish: (id: string) => request<PostRecord>(`/api/posts/${id}/publish`, { method: 'POST' }),
  retry: (id: string) => request<PostRecord>(`/api/posts/${id}/retry`, { method: 'POST' }),
  resolve: (id: string, platform: Platform, outcome: 'published' | 'not_published', remoteId?: string) =>
    request(`/api/posts/${id}/targets/${platform}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome, remoteId, confirmation: 'I checked the provider account' }),
    }),
  deleteProviderPost: (id: string, platform: Platform) => request<{ ok: true }>(`/api/posts/${id}/targets/${platform}`, { method: 'DELETE' }),
  disconnect: (provider: 'google' | 'facebook' | 'instagram') =>
    request<{ ok: true }>(`/api/oauth/${provider}/disconnect`, { method: 'POST' }),
};
