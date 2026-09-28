import { useEffect, useState } from 'react';
import { api, type ApiKeyRecord } from '../lib/api';

export function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.apiKeys().then(setKeys).catch((e) => setError(e.message)); }, []);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true); setError('');
    try {
      const created = await api.createApiKey(name.trim());
      setToken(created.token); setName(''); setKeys(await api.apiKeys());
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setError('');
    try { await api.revokeApiKey(id); setKeys(await api.apiKeys()); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section className="panel settings-card wide-card">
    <div className="settings-content">
      <h2>External API access</h2>
      <p>Create a key for another app to upload media, create posts, and publish through your connected accounts. The key has full access to this workspace. Store it securely; it is shown only once.</p>
      {error && <div className="alert danger">{error}</div>}
      {token && <label className="field"><span>New API key — copy it now</span><input className="input" readOnly value={token} onFocus={(e) => e.currentTarget.select()} /><button className="btn secondary small" type="button" onClick={() => void navigator.clipboard.writeText(token)}>Copy key</button></label>}
      <label className="field"><span>Key name</span><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Example: mobile app" /></label>
      <button className="btn secondary small" type="button" disabled={busy || !name.trim()} onClick={() => void create()}>Create API key</button>
      {keys.map((key) => <div key={key.id} className="settings-row"><span><strong>{key.name}</strong> · {key.prefix}… · Created {new Date(key.createdAt).toLocaleDateString()}</span><button className="btn secondary small" type="button" disabled={busy} onClick={() => void revoke(key.id)}>Revoke</button></div>)}
      <p><a className="inline-link" href="/api-guide.html" target="_blank" rel="noreferrer">Read API guide ↗</a></p>
    </div>
  </section>;
}
