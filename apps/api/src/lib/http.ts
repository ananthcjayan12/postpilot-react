export async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok || payload?.error) {
    const detail = payload?.error?.message || payload?.error_description || payload?.raw || `${response.status} ${response.statusText}`;
    throw new Error(detail);
  }
  return payload as T;
}
