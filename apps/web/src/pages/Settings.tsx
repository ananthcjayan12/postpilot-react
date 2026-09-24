import { BellRing, Database, Save, Shield, TimerReset } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function Settings() {
  const [defaults, setDefaults] = useState({
    youtube: true,
    instagram: true,
    facebook: true,
    notify: true,
    confirm: true,
    schedulerEnabled: true,
  });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void api
      .settings()
      .then(setDefaults)
      .catch((e) => setError(e.message));
  }, []);
  const [error, setError] = useState('');
  const save = async () => {
    try {
      await api.saveSettings(defaults);
      setSaved(true);
      setError('');
      setTimeout(() => setSaved(false), 1800);
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <>
      {error && <div className="alert danger">{error}</div>}
      <div className="page-heading">
        <div>
          <span className="eyebrow">PREFERENCES</span>
          <h1>Settings</h1>
          <p>Workspace defaults and publishing guardrails.</p>
        </div>
        <button className="btn primary" onClick={save}>
          <Save size={16} /> {saved ? 'Saved' : 'Save changes'}
        </button>
      </div>
      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="settings-icon">
            <TimerReset />
          </div>
          <div className="settings-content">
            <h2>Default cross-post channels</h2>
            <p>Preselect these platforms when opening the composer.</p>
            <Toggle
              label="YouTube"
              checked={defaults.youtube}
              onChange={(v) => setDefaults({ ...defaults, youtube: v })}
            />
            <Toggle
              label="Instagram"
              checked={defaults.instagram}
              onChange={(v) => setDefaults({ ...defaults, instagram: v })}
            />
            <Toggle
              label="Facebook"
              checked={defaults.facebook}
              onChange={(v) => setDefaults({ ...defaults, facebook: v })}
            />
          </div>
        </section>
        <section className="panel settings-card">
          <div className="settings-icon purple">
            <BellRing />
          </div>
          <div className="settings-content">
            <h2>Publishing behavior</h2>
            <Toggle
              label="Enable scheduled publishing"
              checked={defaults.schedulerEnabled}
              onChange={(v) => setDefaults({ ...defaults, schedulerEnabled: v })}
            />
            <p>Controls that help prevent accidental publishing.</p>
            <Toggle
              label="Show final confirmation before publish"
              checked={defaults.confirm}
              onChange={(v) => setDefaults({ ...defaults, confirm: v })}
            />
            <Toggle
              label="Completion notifications in this browser"
              checked={defaults.notify}
              onChange={(v) => setDefaults({ ...defaults, notify: v })}
            />
          </div>
        </section>
        <section className="panel settings-card wide-card">
          <div className="settings-icon green">
            <Database />
          </div>
          <div className="settings-content">
            <h2>Data & security</h2>
            <p>
              Your content and schedule are stored in D1, media in a private R2 bucket, and account
              credentials encrypted separately. Publishing continues when you close this browser.
            </p>
            <div className="security-points">
              <span>
                <Shield size={16} /> OAuth tokens are never rendered into the frontend.
              </span>
              <span>
                <Shield size={16} /> Git ignores local media, secrets and environment variables.
              </span>
              <span>
                <Shield size={16} /> Scheduled jobs run independently of your browser.
              </span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </label>
  );
}
