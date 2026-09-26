import { thumbnailPeopleOptions } from '@postpilot/shared';
import { BellRing, Database, Save, Shield, Sparkles, TimerReset } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type Settings as SettingsValue } from '../lib/api';

export function Settings() {
  const [defaults, setDefaults] = useState<SettingsValue>({
    youtube: true,
    instagram: true,
    facebook: true,
    notify: true,
    confirm: true,
    schedulerEnabled: true,
    thumbnailPeople: 'auto',
    geminiConfigured: false,
    openaiConfigured: false,
    aiRoutes: {
      metadata: 'gemini:gemini-3.8-flash',
      hashtags: 'gemini:gemini-3.8-flash',
      thumbnailCopy: 'gemini:gemini-3.8-flash',
      thumbnail: 'gemini:gemini-3.1-flash-image',
      thumbnailResolution: '1K',
    },
    contentLanguage: { mode: 'english' as const, custom: '' },
  });
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [removeOpenaiKey, setRemoveOpenaiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void api
      .settings()
      .then((value) => { setDefaults(value); setLoading(false); })
      .catch((e) => setError(e.message));
  }, []);
  const [error, setError] = useState('');
  const save = async () => {
    setSaving(true);
    try {
      setDefaults(await api.saveSettings({ ...defaults, geminiApiKey: removeKey ? null : geminiApiKey.trim() || undefined, openaiApiKey: removeOpenaiKey ? null : openaiApiKey.trim() || undefined }));
      setGeminiApiKey(''); setRemoveKey(false); setOpenaiApiKey(''); setRemoveOpenaiKey(false);
      setSaved(true);
      setError('');
      setTimeout(() => setSaved(false), 1800);
    } catch (e: any) {
      setError(e.message);
    } finally { setSaving(false); }
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
        <button className="btn primary" onClick={save} disabled={loading || saving}>
          <Save size={16} /> {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
        </button>
      </div>
      <div className="settings-grid">
        <section className="panel settings-card wide-card">
          <div className="settings-icon purple"><Sparkles /></div>
          <div className="settings-content">
            <h2>Gemini video analysis</h2>
            <p>Analyze your video to suggest five SEO-friendly titles and a description. Your key is stored encrypted and never returned to the browser.</p>
            <label className="field"><span>Gemini API key {defaults.geminiConfigured ? '(configured)' : ''}</span><input className="input" type="password" autoComplete="new-password" disabled={loading || saving || removeKey} value={geminiApiKey} onChange={(event) => setGeminiApiKey(event.target.value)} placeholder={defaults.geminiConfigured ? 'Leave blank to keep the current key' : 'Enter your Gemini API key'} /></label>
            <a className="inline-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get a key from Google AI Studio ↗</a>
            {defaults.geminiConfigured && <Toggle label="Remove saved key when saving" checked={removeKey} onChange={setRemoveKey} />}
          </div>
        </section>
        <section className="panel settings-card wide-card">
          <div className="settings-icon purple"><Sparkles /></div>
          <div className="settings-content">
            <h2>Content language</h2>
            <p>Controls the language used for AI-generated titles, captions, hashtags, and thumbnail writing. Manual text is never translated.</p>
            <div className="language-settings">
              <label className="field"><span>Language or mix</span><select className="input" value={defaults.contentLanguage.mode} onChange={(e) => setDefaults({ ...defaults, contentLanguage: { ...defaults.contentLanguage, mode: e.target.value as typeof defaults.contentLanguage.mode } })}><option value="english">English</option><option value="malayalam">Malayalam</option><option value="malayalam_english">Malayalam + English</option><option value="custom">Custom language or mix</option></select></label>
              {defaults.contentLanguage.mode === 'custom' && <label className="field"><span>Custom language instruction</span><input className="input" maxLength={120} value={defaults.contentLanguage.custom} onChange={(e) => setDefaults({ ...defaults, contentLanguage: { ...defaults.contentLanguage, custom: e.target.value } })} placeholder="Example: Tamil + English, conversational" /><small>{defaults.contentLanguage.custom.length}/120</small></label>}
            </div>
          </div>
        </section>
        <section className="panel settings-card wide-card">
          <div className="settings-icon purple"><Sparkles /></div>
          <div className="settings-content">
            <h2>People in thumbnails</h2>
            <p>Choose a preferred background for newly generated people. This applies when a person suits the video; preserving a reference person keeps their identity.</p>
            <label className="field"><span>Generated people</span><select className="input" disabled={loading || saving} value={defaults.thumbnailPeople} onChange={(e) => setDefaults({ ...defaults, thumbnailPeople: e.target.value as SettingsValue['thumbnailPeople'] })}>{Object.entries(thumbnailPeopleOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
        </section>
        <section className="panel settings-card wide-card">
          <div className="settings-icon purple"><Sparkles /></div>
          <div className="settings-content">
            <h2>AI model router</h2>
            <p>Choose the provider and model used for each generation task. A configured API key is required for the selected provider.</p>
            <div className="model-router">
              <label className="field"><span>Video metadata</span><select className="input" value={defaults.aiRoutes.metadata} onChange={(e) => setDefaults({ ...defaults, aiRoutes: { ...defaults.aiRoutes, metadata: e.target.value as typeof defaults.aiRoutes.metadata } })}><option value="gemini:gemini-3.8-flash">Gemini · 3.8 Flash</option><option value="gemini:gemini-2.5-flash">Gemini · 2.5 Flash</option></select><small>Video analysis currently requires Gemini.</small></label>
              <label className="field"><span>Instagram hashtags</span><select className="input" value={defaults.aiRoutes.hashtags} onChange={(e) => setDefaults({ ...defaults, aiRoutes: { ...defaults.aiRoutes, hashtags: e.target.value as typeof defaults.aiRoutes.hashtags } })}><option value="gemini:gemini-3.8-flash">Gemini · 3.8 Flash</option><option value="gemini:gemini-2.5-flash">Gemini · 2.5 Flash</option><option value="openai:gpt-5-mini">OpenAI · GPT-5 mini</option><option value="openai:gpt-4.1-mini">OpenAI · GPT-4.1 mini</option></select></label>
              <label className="field"><span>Thumbnail writing</span><select className="input" value={defaults.aiRoutes.thumbnailCopy} onChange={(e) => setDefaults({ ...defaults, aiRoutes: { ...defaults.aiRoutes, thumbnailCopy: e.target.value as typeof defaults.aiRoutes.thumbnailCopy } })}><option value="gemini:gemini-3.8-flash">Gemini · 3.8 Flash</option><option value="gemini:gemini-2.5-flash">Gemini · 2.5 Flash</option><option value="openai:gpt-5-mini">OpenAI · GPT-5 mini</option><option value="openai:gpt-4.1-mini">OpenAI · GPT-4.1 mini</option></select><small>Creates one short, catchy hook before generating the image.</small></label>
              <label className="field"><span>Thumbnail generation</span><select className="input" value={defaults.aiRoutes.thumbnail} onChange={(e) => { const thumbnail = e.target.value as typeof defaults.aiRoutes.thumbnail; setDefaults({ ...defaults, aiRoutes: { ...defaults.aiRoutes, thumbnail, thumbnailResolution: thumbnail === 'gemini:gemini-2.5-flash-image' ? '1K' : defaults.aiRoutes.thumbnailResolution } }); }}><option value="gemini:gemini-3.1-flash-image">Gemini · 3.1 Flash Image</option><option value="gemini:gemini-2.5-flash-image">Gemini · 2.5 Flash Image (1K only)</option><option value="openai:gpt-image-2.5-flare">OpenAI · GPT Image 2.5 Flare</option><option value="openai:gpt-image-2.5-sunburst">OpenAI · GPT Image 2.5 Sunburst</option></select></label>
              <label className="field"><span>Thumbnail resolution</span><select className="input" value={defaults.aiRoutes.thumbnailResolution} onChange={(e) => setDefaults({ ...defaults, aiRoutes: { ...defaults.aiRoutes, thumbnailResolution: e.target.value as typeof defaults.aiRoutes.thumbnailResolution } })}><option value="1K">1K · Fastest</option><option value="2K" disabled={defaults.aiRoutes.thumbnail === 'gemini:gemini-2.5-flash-image'}>2K · Detailed</option><option value="4K" disabled={defaults.aiRoutes.thumbnail === 'gemini:gemini-2.5-flash-image'}>4K · Maximum</option></select><small>Landscape: {defaults.aiRoutes.thumbnail.startsWith('openai:') ? ({ '1K': '1376×768', '2K': '2048×1152', '4K': '3840×2160' } as const)[defaults.aiRoutes.thumbnailResolution] : defaults.aiRoutes.thumbnail === 'gemini:gemini-2.5-flash-image' ? 'provider default (about 1K)' : ({ '1K': '1376×768', '2K': '2752×1536', '4K': '5504×3072' } as const)[defaults.aiRoutes.thumbnailResolution]}. Shorts automatically transpose to 9:16. Higher resolution increases latency, storage, and API cost.</small></label>
            </div>
          </div>
        </section>
        <section className="panel settings-card wide-card">
          <div className="settings-icon purple"><Sparkles /></div>
          <div className="settings-content">
            <h2>OpenAI image & hashtag generation</h2>
            <p>Generate social thumbnails and Instagram hashtags. Your key is encrypted and never returned to the browser.</p>
            <label className="field"><span>OpenAI API key {defaults.openaiConfigured ? '(configured)' : ''}</span><input className="input" type="password" autoComplete="new-password" disabled={loading || saving || removeOpenaiKey} value={openaiApiKey} onChange={(event) => setOpenaiApiKey(event.target.value)} placeholder={defaults.openaiConfigured ? 'Leave blank to keep the current key' : 'Enter your OpenAI API key'} /></label>
            <a className="inline-link" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Manage OpenAI API keys ↗</a>
            {defaults.openaiConfigured && <Toggle label="Remove saved key when saving" checked={removeOpenaiKey} onChange={setRemoveOpenaiKey} />}
          </div>
        </section>
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
