import { CalendarClock, Check, CloudUpload, Facebook, Instagram, LoaderCircle, Play, Save, Send, Sparkles, UploadCloud, Youtube } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { AccountsResponse, MediaAsset, Platform } from '../lib/types';

const platforms: { id: Platform; label: string; icon: any; helper: string }[] = [
  { id: 'youtube', label: 'YouTube', icon: Youtube, helper: 'Upload as a public video' },
  { id: 'instagram', label: 'Instagram', icon: Instagram, helper: 'Publish video as a Reel' },
  { id: 'facebook', label: 'Facebook', icon: Facebook, helper: 'Publish to your Facebook Page' }
];

export function CreatePost() {
  const navigate = useNavigate();
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const [localPreview, setLocalPreview] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [selected, setSelected] = useState<Platform[]>(['youtube', 'instagram', 'facebook']);
  const [schedule, setSchedule] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<AccountsResponse | null>(null);
  useEffect(() => { void api.accounts().then(setAccounts); }, []);
  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);

  const metaSelected = selected.includes('instagram') || selected.includes('facebook');
  const missingConnections = useMemo(() => selected.filter((p) => !accounts?.accounts[p]?.connected), [accounts, selected]);

  const chooseFile = async (file?: File) => {
    if (!file) return;
    setError(''); setBusy('Uploading media…');
    const preview = URL.createObjectURL(file); setLocalPreview(preview);
    try {
      const uploaded = await api.upload(file);
      setAsset(uploaded);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
    } catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };
  const toggle = (platform: Platform) => setSelected((current) => current.includes(platform) ? current.filter((p) => p !== platform) : [...current, platform]);
  const submit = async (action: 'draft' | 'schedule' | 'publish') => {
    setError('');
    if (!asset) return setError('Upload a video or image first.');
    if (!title.trim()) return setError('Add a title.');
    if (!selected.length) return setError('Choose at least one platform.');
    if (action === 'schedule' && !schedule) return setError('Choose a schedule date and time.');
    setBusy(action === 'publish' ? 'Publishing to selected platforms…' : action === 'schedule' ? 'Adding to schedule…' : 'Saving draft…');
    try {
      const post = await api.createPost({ title, caption, mediaId: asset.id, platforms: selected, action, scheduledFor: schedule ? new Date(schedule).toISOString() : undefined });
      if (post.status === 'failed' || post.status === 'partial') setError(post.lastError || 'One or more platforms failed to publish.');
      else navigate(action === 'schedule' ? '/calendar' : '/library');
    } catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">CREATE</span><h1>Upload Video</h1><p>Create once, then publish the same media across your connected channels.</p></div><button className="btn secondary" onClick={() => void submit('draft')} disabled={!!busy}><Save size={17} /> Save Draft</button></div>
      {error && <div className="alert danger">{error}</div>}
      {metaSelected && accounts && !accounts.readiness.publicMediaUrlConfigured && <div className="alert warning"><strong>Meta needs a public media URL.</strong> Uploading works locally, but Instagram/Facebook publishing needs <code>PUBLIC_BASE_URL</code>. The README includes a free local tunnel setup.</div>}
      <div className="composer-grid">
        <section className="panel composer-main">
          <div className="section-kicker">1 · MEDIA</div>
          {!asset ? (
            <label className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void chooseFile(e.dataTransfer.files?.[0]); }}>
              <div className="drop-icon"><CloudUpload /></div>
              <h3>Drag & drop your video here</h3><p>or click to browse from your computer</p><span>MP4, MOV, WEBM, JPG, PNG · up to 5 GB</span>
              <input type="file" accept="video/*,image/*" onChange={(e) => void chooseFile(e.target.files?.[0])} hidden />
            </label>
          ) : (
            <div className="media-preview">
              {asset.mimeType.startsWith('video/') ? <video src={localPreview || asset.localUrl} controls /> : <img src={localPreview || asset.localUrl} alt="preview" />}
              <div className="media-preview-bar"><div><strong>{asset.originalName}</strong><span>{(asset.size / 1024 / 1024).toFixed(1)} MB · uploaded</span></div><label className="btn secondary small"><UploadCloud size={15} /> Replace<input type="file" accept="video/*,image/*" hidden onChange={(e) => void chooseFile(e.target.files?.[0])} /></label></div>
            </div>
          )}
          <div className="section-kicker">2 · DETAILS</div>
          <div className="form-grid">
            <label className="field full"><span>Title</span><input className="input" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="Exploring Japan — A Visual Journey" /><small>{title.length}/100</small></label>
            <label className="field full"><span>Caption / description</span><textarea className="textarea" value={caption} maxLength={5000} onChange={(e) => setCaption(e.target.value)} placeholder="Tell your audience what this video is about…" /><small>{caption.length}/5000</small></label>
          </div>
          <div className="ai-hint"><Sparkles size={17} /><span><strong>Tip:</strong> Keep the first 125 characters strong; Instagram truncates long captions in-feed.</span></div>
        </section>

        <aside className="panel composer-side">
          <div className="section-kicker">3 · CHANNELS</div>
          <h3>Choose platforms</h3><p className="muted">PostPilot will use each platform’s official API.</p>
          <div className="platform-select-list">
            {platforms.map(({ id, label, icon: Icon, helper }) => {
              const on = selected.includes(id); const connected = accounts?.accounts[id]?.connected;
              return <button key={id} className={`platform-select ${id} ${on ? 'selected' : ''}`} onClick={() => toggle(id)}><span className="platform-icon"><Icon /></span><span className="platform-copy"><strong>{label}</strong><small>{connected ? helper : 'Not connected yet'}</small></span><span className={`select-check ${on ? 'on' : ''}`}>{on && <Check size={14} />}</span></button>;
            })}
          </div>
          {missingConnections.length > 0 && <a className="inline-link" href="/accounts">Connect selected accounts first →</a>}
          <div className="divider" />
          <div className="section-kicker">4 · PUBLISHING</div>
          <label className="field"><span>Schedule for later</span><input className="input" type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} /></label>
          <button className="btn secondary wide" disabled={!!busy || !schedule} onClick={() => void submit('schedule')}><CalendarClock size={17} /> Schedule Post</button>
          <button className="btn primary wide" disabled={!!busy} onClick={() => void submit('publish')}>{busy ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}{busy || 'Publish Now'}</button>
          <div className="preview-mini"><div className="preview-screen">{asset ? (asset.mimeType.startsWith('video/') ? <><video src={localPreview || asset.localUrl} muted /><span className="play-chip"><Play fill="currentColor" size={13} /></span></> : <img src={localPreview || asset.localUrl} alt="" />) : <div className="preview-placeholder">Preview</div>}</div><strong>{title || 'Your post title'}</strong><span>{caption || 'Your caption will appear here.'}</span></div>
        </aside>
      </div>
    </>
  );
}
