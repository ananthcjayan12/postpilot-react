import { CheckCircle2, ExternalLink, Facebook, Instagram, Link2, RefreshCw, ShieldCheck, Unplug, Youtube } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import type { AccountsResponse, Platform } from '../lib/types';

const channelMeta: Record<Platform, { label: string; icon: any; description: string }> = {
  youtube: { label: 'YouTube', icon: Youtube, description: 'Upload videos with the YouTube Data API.' },
  instagram: { label: 'Instagram', icon: Instagram, description: 'Publish through the Instagram API with Facebook Login to the Professional account linked to your Page.' },
  facebook: { label: 'Facebook', icon: Facebook, description: 'Publish videos and photos to your Facebook Page with pages_manage_posts.' }
};

export function Accounts() {
  const [state, setState] = useState<AccountsResponse | null>(null);
  const [busy, setBusy] = useState('');
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const oauthError = params.get('error');
  const connected = params.get('connected');
  const refresh = () => void api.accounts().then(setState);
  useEffect(refresh, [location.search]);
  const disconnect = async (provider: 'google' | 'meta') => { setBusy(provider); try { await api.disconnect(provider); refresh(); } finally { setBusy(''); } };
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">INTEGRATIONS</span><h1>Connected Accounts</h1><p>Authorize the official APIs once, then PostPilot can publish and schedule from your machine.</p></div><button className="btn secondary" onClick={refresh}><RefreshCw size={16} /> Refresh</button></div>
      {oauthError && <div className="alert danger">{oauthError}</div>}
      {connected && <div className="alert success"><CheckCircle2 size={17} /> Connection completed. Your account details are stored locally.</div>}
      <div className="account-grid">
        {(['youtube','instagram','facebook'] as Platform[]).map((platform) => {
          const meta = channelMeta[platform]; const Icon = meta.icon; const account = state?.accounts?.[platform];
          const provider = platform === 'youtube' ? 'google' : 'meta';
          return <section className={`panel account-card ${platform}`} key={platform}><div className="account-card-head"><span className={`account-logo ${platform}`}><Icon /></span><div><h2>{meta.label}</h2><p>{meta.description}</p></div><span className={`connection-pill ${account?.connected ? 'connected' : ''}`}><i />{account?.connected ? 'Connected' : 'Not connected'}</span></div><div className="account-body">{account?.connected ? <><div className="connected-profile"><div className="channel-avatar">{(account.displayName || meta.label).charAt(0).toUpperCase()}</div><div><strong>{account.displayName || meta.label}</strong><span>{account.detail || account.accountId}</span></div></div><div className="account-actions">{platform === 'youtube' ? <button disabled={!!busy} className="btn danger-outline" onClick={() => void disconnect('google')}><Unplug size={16} /> Disconnect</button> : platform === 'facebook' ? <button disabled={!!busy} className="btn danger-outline" onClick={() => void disconnect('meta')}><Unplug size={16} /> Disconnect Meta</button> : <span className="muted tiny">Instagram is managed through the same Meta authorization.</span>}</div></> : <><div className="connection-copy"><Link2 size={20}/><div><strong>Ready to connect</strong><span>{platform === 'youtube' ? (state?.readiness.googleConfigured ? 'Google OAuth credentials detected.' : 'Add Google OAuth credentials to .env first.') : (state?.readiness.metaConfigured ? 'Meta Facebook Login credentials detected.' : 'Add Meta app credentials to .env first.')}</span></div></div>{platform === 'instagram' ? <a className="btn secondary wide" href="/api/oauth/meta/start"><Instagram size={17}/> Connect through Meta</a> : <a className="btn primary wide" href={`/api/oauth/${provider}/start`}><ExternalLink size={16}/> Connect {meta.label}</a>}</>}</div></section>;
        })}
      </div>
      <section className="panel readiness-panel"><div className="section-title"><div><h2>Publishing readiness</h2><p>These are the only infrastructure checks needed for this local setup.</p></div></div><div className="readiness-list"><Readiness ok={!!state?.readiness.googleConfigured} title="Google OAuth credentials" text="Needed for YouTube uploads and refresh tokens."/><Readiness ok={!!state?.readiness.metaConfigured} title="Meta app credentials" text="Needed for Facebook Page + Instagram Professional publishing."/><Readiness ok={!!state?.readiness.publicMediaUrlConfigured} title="Public media URL" text={state?.readiness.publicBaseUrl || 'Required so Meta can fetch uploaded media. A free HTTPS tunnel works for local development.'}/><Readiness ok title="Encrypted token storage" text="OAuth credentials are encrypted at rest with APP_ENCRYPTION_KEY and never sent to the React client."/></div></section>
    </>
  );
}

function Readiness({ ok, title, text }: { ok: boolean; title: string; text: string }) { return <div className="readiness-item"><span className={`readiness-icon ${ok ? 'ok' : ''}`}>{ok ? <ShieldCheck /> : <Link2 />}</span><div><strong>{title}</strong><span>{text}</span></div><span className={`ready-tag ${ok ? 'ok' : ''}`}>{ok ? 'Ready' : 'Setup needed'}</span></div>; }
