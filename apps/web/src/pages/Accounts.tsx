import {
  CheckCircle2,
  ExternalLink,
  Facebook,
  Instagram,
  Link2,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Youtube,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import type { AccountsResponse, Platform } from '../lib/types';

const channelMeta: Record<
  Platform,
  { label: string; icon: any; description: string; provider: 'google' | 'facebook' | 'instagram' }
> = {
  youtube: {
    label: 'YouTube',
    icon: Youtube,
    description: 'Upload videos with the YouTube Data API.',
    provider: 'google',
  },
  instagram: {
    label: 'Instagram',
    icon: Instagram,
    description:
      'Connect a Business or Creator account directly with Instagram Login. No Facebook Page is required.',
    provider: 'instagram',
  },
  facebook: {
    label: 'Facebook',
    icon: Facebook,
    description: 'Connect a Facebook Page independently with Facebook Login.',
    provider: 'facebook',
  },
};

function configured(state: AccountsResponse | null, platform: Platform) {
  if (!state) return false;
  if (platform === 'youtube') return state.readiness.googleConfigured;
  if (platform === 'instagram') return state.readiness.instagramConfigured;
  return state.readiness.facebookConfigured;
}

export function Accounts() {
  const [state, setState] = useState<AccountsResponse | null>(null);
  const [busy, setBusy] = useState('');
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const oauthError = params.get('error');
  const connected = params.get('connected');

  const refresh = () => void api.accounts().then(setState);
  useEffect(refresh, [location.search]);

  const disconnect = async (provider: 'google' | 'facebook' | 'instagram') => {
    setBusy(provider);
    try {
      await api.disconnect(provider);
      refresh();
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">INTEGRATIONS</span>
          <h1>Connected Accounts</h1>
          <p>
            Connect each network independently. Instagram uses direct Instagram Login; Facebook uses
            its own Page authorization.
          </p>
        </div>
        <button className="btn secondary" onClick={refresh}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {oauthError && <div className="alert danger">{oauthError}</div>}
      {connected && (
        <div className="alert success">
          <CheckCircle2 size={17} /> {connected === 'instagram' ? 'Instagram' : connected === 'facebook' ? 'Facebook' : 'YouTube'} connected successfully. Credentials are encrypted server-side.
        </div>
      )}

      <div className="account-grid">
        {(['youtube', 'instagram', 'facebook'] as Platform[]).map((platform) => {
          const meta = channelMeta[platform];
          const Icon = meta.icon;
          const account = state?.accounts?.[platform];
          const ready = configured(state, platform);

          return (
            <section className={`panel account-card ${platform}`} key={platform}>
              <div className="account-card-head">
                <span className={`account-logo ${platform}`}>
                  <Icon />
                </span>
                <div>
                  <h2>{meta.label}</h2>
                  <p>{meta.description}</p>
                </div>
                <span className={`connection-pill ${account?.connected ? 'connected' : ''}`}>
                  <i />
                  {account?.connected ? 'Connected' : 'Not connected'}
                </span>
              </div>

              <div className="account-body">
                {account?.connected ? (
                  <>
                    <div className="connected-profile">
                      <div className="channel-avatar">
                        {(account.displayName || meta.label).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <strong>{account.displayName || meta.label}</strong>
                        <span>{account.detail || account.accountId}</span>
                      </div>
                    </div>
                    <div className="account-actions">
                      <button
                        disabled={!!busy}
                        className="btn danger-outline"
                        onClick={() => void disconnect(meta.provider)}
                      >
                        <Unplug size={16} /> Disconnect {meta.label}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="connection-copy">
                      <Link2 size={20} />
                      <div>
                        <strong>{ready ? 'Ready to connect' : 'Credentials required'}</strong>
                        <span>
                          {ready
                            ? platform === 'instagram'
                              ? 'Instagram OAuth credentials detected.'
                              : platform === 'facebook'
                                ? 'Facebook OAuth credentials detected.'
                                : 'Google OAuth credentials detected.'
                            : 'Add this provider\'s app credentials in deployment secrets first.'}
                        </span>
                      </div>
                    </div>
                    <a
                      className={`btn ${platform === 'instagram' ? 'secondary' : 'primary'} wide`}
                      href={`/api/oauth/${meta.provider}/start`}
                    >
                      <ExternalLink size={16} /> Connect {meta.label}
                    </a>
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <section className="panel readiness-panel">
        <div className="section-title">
          <div>
            <h2>Publishing readiness</h2>
            <p>Each provider has its own authorization and can be configured independently.</p>
          </div>
        </div>
        <div className="readiness-list">
          <Readiness
            ok={!!state?.readiness.googleConfigured}
            title="Google OAuth credentials"
            text="Required for YouTube uploads and refresh tokens."
          />
          <Readiness
            ok={!!state?.readiness.instagramConfigured}
            title="Instagram OAuth credentials"
            text="Required for direct Instagram Business/Creator login and publishing."
          />
          <Readiness
            ok={!!state?.readiness.facebookConfigured}
            title="Facebook OAuth credentials"
            text="Required for Facebook Page discovery and publishing."
          />
          <Readiness
            ok={!!state?.readiness.publicMediaUrlConfigured}
            title="Public media URL"
            text={
              state?.readiness.publicBaseUrl ||
              'Required so Instagram and Facebook can fetch uploaded media.'
            }
          />
          <Readiness
            ok
            title="Encrypted token storage"
            text="OAuth credentials are encrypted at rest and never exposed to the React client."
          />
        </div>
      </section>
    </>
  );
}

function Readiness({ ok, title, text }: { ok: boolean; title: string; text: string }) {
  return (
    <div className="readiness-item">
      <span className={`readiness-icon ${ok ? 'ok' : ''}`}>
        {ok ? <ShieldCheck /> : <Link2 />}
      </span>
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
      <span className={`ready-tag ${ok ? 'ok' : ''}`}>{ok ? 'Ready' : 'Setup needed'}</span>
    </div>
  );
}
