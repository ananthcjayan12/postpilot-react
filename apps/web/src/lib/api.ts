import type { AccountsResponse, MediaAsset, Platform, PostRecord } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : body?.error ? JSON.stringify(body.error) : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  posts: () => request<PostRecord[]>('/api/posts'),
  media: () => request<MediaAsset[]>('/api/media'),
  accounts: () => request<AccountsResponse>('/api/accounts'),
  analytics: () => request<any>('/api/analytics'),
  upload: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<MediaAsset>('/api/media', { method: 'POST', body: form });
  },
  createPost: (input: {
    title: string;
    caption: string;
    mediaId: string;
    platforms: Platform[];
    action: 'draft' | 'schedule' | 'publish';
    scheduledFor?: string;
  }) => request<PostRecord>('/api/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  }),
  publish: (id: string) => request<PostRecord>(`/api/posts/${id}/publish`, { method: 'POST' }),
  retry: (id: string) => request<PostRecord>(`/api/posts/${id}/retry`, { method: 'POST' }),
  disconnect: (provider: 'google' | 'meta') => request<{ ok: true }>(`/api/oauth/${provider}/disconnect`, { method: 'POST' })
};
