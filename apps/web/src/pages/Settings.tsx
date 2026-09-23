import { BellRing, Database, Save, Shield, TimerReset } from 'lucide-react';
import { useEffect, useState } from 'react';

export function Settings() {
  const [defaults, setDefaults] = useState({ youtube: true, instagram: true, facebook: true, notify: true, confirm: true });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const raw = localStorage.getItem('postpilot-settings');
    if (raw) try { setDefaults(JSON.parse(raw)); } catch {}
  }, []);
  const save = () => { localStorage.setItem('postpilot-settings', JSON.stringify(defaults)); setSaved(true); setTimeout(() => setSaved(false), 1800); };
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">PREFERENCES</span><h1>Settings</h1><p>Local workspace defaults and publishing guardrails.</p></div><button className="btn primary" onClick={save}><Save size={16} /> {saved ? 'Saved' : 'Save changes'}</button></div>
      <div className="settings-grid">
        <section className="panel settings-card"><div className="settings-icon"><TimerReset /></div><div className="settings-content"><h2>Default cross-post channels</h2><p>Preselect these platforms when opening the composer.</p><Toggle label="YouTube" checked={defaults.youtube} onChange={(v) => setDefaults({...defaults, youtube:v})}/><Toggle label="Instagram" checked={defaults.instagram} onChange={(v) => setDefaults({...defaults, instagram:v})}/><Toggle label="Facebook" checked={defaults.facebook} onChange={(v) => setDefaults({...defaults, facebook:v})}/></div></section>
        <section className="panel settings-card"><div className="settings-icon purple"><BellRing /></div><div className="settings-content"><h2>Publishing behavior</h2><p>Controls that help prevent accidental publishing.</p><Toggle label="Show final confirmation before publish" checked={defaults.confirm} onChange={(v) => setDefaults({...defaults, confirm:v})}/><Toggle label="Local completion notifications" checked={defaults.notify} onChange={(v) => setDefaults({...defaults, notify:v})}/></div></section>
        <section className="panel settings-card wide-card"><div className="settings-icon green"><Database /></div><div className="settings-content"><h2>Local data & security</h2><p>PostPilot stores the content index in <code>apps/api/data/postpilot.json</code>, media in <code>apps/api/data/uploads</code>, and encrypted OAuth credentials in <code>apps/api/data/secrets.json</code>. All three are excluded from Git.</p><div className="security-points"><span><Shield size={16}/> OAuth tokens are never rendered into the frontend.</span><span><Shield size={16}/> Git ignores local media, secrets and environment variables.</span><span><Shield size={16}/> Scheduled jobs survive API restarts because their state is persisted.</span></div></div></section>
      </div>
    </>
  );
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v:boolean)=>void }) { return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(e)=>onChange(e.target.checked)}/><i /></label>; }
