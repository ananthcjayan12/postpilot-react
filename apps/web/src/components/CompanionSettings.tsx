import { useEffect, useState } from 'react';
import { api, type CompanionDevice } from '../lib/api';

export function CompanionSettings() {
  const [devices, setDevices] = useState<CompanionDevice[]>([]);
  const [pair, setPair] = useState<{ code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setDevices(await api.companionDevices());
  };
  useEffect(() => {
    let mounted = true;
    const update = () =>
      api
        .companionDevices()
        .then((d) => {
          if (mounted) setDevices(d);
        })
        .catch((e) => {
          if (mounted) setError(e.message);
        });
    void update();
    const timer = setInterval(() => void update(), 5000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel settings-card wide-card">
      <div className="settings-content">
        <h2>AI on your computer · Optional</h2>
        <p>
          Use your signed-in Codex or Antigravity CLI for hashtags and thumbnail headlines. Keep the PostPilot
          companion running on your computer. Provider account limits apply.
        </p>
        <p><a className="inline-link" href="https://github.com/ananthcjayan12/postpilot-react/releases?q=companion-v" target="_blank" rel="noreferrer">Download the desktop companion for macOS or Windows ↗</a></p>
        <ol>
          <li>Install and sign in to your chosen CLI.</li>
          <li>Open PostPilot Companion and enter this website’s URL: <code>{location.origin}</code>.</li>
          <li>Create a pairing code below, enter it in the companion, then click Start.</li>
          <li>Select your local provider in the AI model router and save changes.</li>
        </ol>
        <small>Desktop installers appear on GitHub after a companion release is published. Developers can also run <code>npm run companion -- pair</code> followed by <code>npm run companion</code>.</small>
        <button
          className="btn secondary"
          disabled={busy}
          onClick={() => void run(async () => setPair(await api.pairCompanion()))}
        >
          Create pairing code
        </button>
        {pair && pair.expiresAt > Date.now() && (
          <div className="alert" role="status">
            <p>One-time code · expires in five minutes. Keep it private.</p>
            <code style={{ overflowWrap: 'anywhere' }}>{pair.code}</code>
          </div>
        )}
        {error && (
          <div className="alert danger" role="alert">
            {error}
          </div>
        )}
        {!devices.length && <p>No computers paired yet.</p>}
        {devices.map((d) => (
          <div key={d.id} style={{ marginTop: 16 }}>
            <strong>{d.name}</strong> · {d.online ? 'Connected' : 'Computer offline'}
            <ul>
              {Object.entries(d.capabilities).map(([name, c]) => (
                <li key={name}>
                  {name}: {c.ready ? 'Ready' : 'Not ready'} — {c.detail}
                </li>
              ))}
            </ul>
            {d.jobs?.map((job) => (
              <p key={job.id}>
                {job.task === 'hashtags' ? 'Hashtags' : 'Thumbnail headline'} · {job.status}{' '}
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => void run(() => api.cancelCompanionJob(job.id))}
                >
                  Cancel job
                </button>
              </p>
            ))}
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => void run(() => api.revokeCompanion(d.id))}
            >
              Disconnect {d.name}
            </button>
          </div>
        ))}
        <p>
          <small>
            Disconnecting revokes this device’s access and cancels its pending jobs. Video analysis and
            thumbnail images continue to use your selected API providers.
          </small>
        </p>
      </div>
    </section>
  );
}
