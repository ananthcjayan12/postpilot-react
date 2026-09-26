import { CalendarClock, Check, CloudUpload, Facebook, Instagram, LoaderCircle, Play, Save, Send, Sparkles, UploadCloud, Youtube } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { shortsEligibility, type VideoMetadata } from '@postpilot/shared';
import type { AccountsResponse, MediaAsset, Platform } from '../lib/types';

const platforms: { id: Platform; label: string; icon: any; helper: string }[] = [
  { id: 'youtube', label: 'YouTube', icon: Youtube, helper: 'Publish a video or Short' },
  { id: 'instagram', label: 'Instagram', icon: Instagram, helper: 'Publish video as a Reel' },
  { id: 'facebook', label: 'Facebook', icon: Facebook, helper: 'Publish to your Facebook Page' }
];

export function CreatePost() {
  const navigate = useNavigate();
  const { postId } = useParams();
  const [searchParams] = useSearchParams();
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const [localPreview, setLocalPreview] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [thumbnail, setThumbnail] = useState<MediaAsset | null>(null);
  const [referenceImage, setReferenceImage] = useState<MediaAsset | null>(null);
  const [generatedThumbnailText, setGeneratedThumbnailText] = useState('');
  const [thumbnailFeedback, setThumbnailFeedback] = useState('');
  const [referenceMode, setReferenceMode] = useState<'preserve' | 'style'>('style');
  const [suggestions, setSuggestions] = useState<{ titles: string[]; description: string } | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata>();
  const [youtubeFormat, setYoutubeFormat] = useState<'video' | 'short'>('video');
  const [selected, setSelected] = useState<Platform[]>(['youtube', 'instagram', 'facebook']);
  const [schedule, setSchedule] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<AccountsResponse | null>(null);
  const [confirmPublish,setConfirmPublish]=useState(true);
  const [loadingProject, setLoadingProject] = useState(true);
  useEffect(() => {
    void Promise.all([api.settings(), api.accounts(), api.media(), api.posts()])
      .then(([settings, connectedAccounts, media, posts]) => {
        setAccounts(connectedAccounts); setConfirmPublish(settings.confirm);
        const project = postId ? posts.find((post) => post.id === postId) : undefined;
        const mediaId = project?.mediaId || searchParams.get('mediaId');
        const existingAsset = mediaId ? media.find((item) => item.id === mediaId) : undefined;
        if (postId && !project) throw new Error('This project could not be found.');
        if (mediaId && !existingAsset) throw new Error('This uploaded media could not be found.');
        if (project && !['draft', 'scheduled'].includes(project.status)) throw new Error('Only draft or scheduled projects can be resumed.');
        if (existingAsset) setAsset(existingAsset);
        if (project) {
          setTitle(project.title); setCaption(project.caption); setSelected(project.platforms);
          setHashtags(project.hashtags || '');
          if (project.thumbnailMediaId) setThumbnail(media.find((item) => item.id === project.thumbnailMediaId) || null);
          setYoutubeFormat(project.youtubeFormat || 'video');
          if (project.scheduledFor) {
            const date = new Date(project.scheduledFor);
            setSchedule(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
          }
        } else {
          setSelected((['youtube','instagram','facebook'] as Platform[]).filter((platform) => settings[platform]));
          if (existingAsset) setTitle(existingAsset.originalName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingProject(false));
  }, [postId, searchParams]);
  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);

  const metaSelected = selected.includes('instagram') || selected.includes('facebook');
  const missingConnections = useMemo(() => selected.filter((p) => !accounts?.accounts[p]?.connected), [accounts, selected]);

  const chooseFile = async (file?: File) => {
    if (!file || busy) return;
    setAsset(null);
    setSuggestions(null);
    setVideoMetadata(undefined);
    setYoutubeFormat('video');
    setError(''); setBusy('Uploading media…');
    const preview = URL.createObjectURL(file); setLocalPreview(preview);
    try {
      const uploaded = await api.upload(file, percentage=>setBusy(`Uploading media… ${percentage}%`));
      setAsset(uploaded);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
    } catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };
  const toggle = (platform: Platform) => setSelected((current) => current.includes(platform) ? current.filter((p) => p !== platform) : [...current, platform]);
  const analyze = async () => {
    if (!asset || busy) return;
    setBusy('Gemini is analyzing your video…'); setError(''); setSuggestions(null);
    try { setSuggestions(await api.suggestMetadata(asset.id, youtubeFormat)); }
    catch (error: any) { setError(error.message); }
    finally { setBusy(''); }
  };
  const generateHashtags = async () => {
    if (!title.trim() || busy) return setError('Add a title before generating hashtags.');
    setBusy('Generating hashtags…'); setError('');
    try { setHashtags((await api.generateHashtags(title, caption)).hashtags); }
    catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };
  const generateThumbnail = async () => {
    if (!title.trim() || busy) return setError('Add a title before generating a thumbnail.');
    setBusy('Generating thumbnail…'); setError('');
    try { const result = await api.generateThumbnail(title, caption, youtubeFormat === 'short' ? 'vertical' : 'horizontal', referenceImage?.id, generatedThumbnailText || undefined, referenceMode); setThumbnail(result); setGeneratedThumbnailText(result.thumbnailText); }
    catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };
  const generateThumbnailCopy = async () => {
    if (!title.trim() || busy) return setError('Add a title before generating thumbnail writing.');
    setBusy(generatedThumbnailText ? 'Regenerating thumbnail hook…' : 'Writing thumbnail hook…'); setError('');
    try { const result = await api.generateThumbnailCopy(title, caption, thumbnailFeedback.trim() || undefined); setGeneratedThumbnailText(result.thumbnailText); setThumbnailFeedback(''); }
    catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };
  const chooseThumbnail = async (file?: File) => {
    if (!file || busy) return;
    if (!file.type.startsWith('image/')) return setError('Thumbnail must be an image.');
    setBusy('Uploading thumbnail…'); setError('');
    try { setThumbnail(await api.upload(file)); } catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };
  const chooseReference = async (file?: File) => {
    if (!file || busy) return;
    if (!file.type.startsWith('image/')) return setError('Reference must be an image.');
    if (file.size > 10 * 1024 * 1024) return setError('Reference image must be 10 MB or smaller.');
    setBusy('Uploading reference image…'); setError('');
    try { setReferenceImage(await api.upload(file)); } catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };
  const submit = async (action: 'draft' | 'schedule' | 'publish') => {
    setError('');
    if (!asset) return setError('Upload a video or image first.');
    if (!title.trim()) return setError('Add a title.');
    if (!selected.length) return setError('Choose at least one platform.');
    if (selected.includes('youtube') && youtubeFormat === 'short') {
      const eligibilityError = shortsEligibility(videoMetadata);
      if (eligibilityError) return setError(eligibilityError);
    }
    if (action === 'schedule' && !schedule) return setError('Choose a schedule date and time.');
    if (action === 'publish' && confirmPublish && !window.confirm('Publish this post to the selected accounts?')) return;
    setBusy(action === 'publish' ? 'Publishing to selected platforms…' : action === 'schedule' ? 'Adding to schedule…' : 'Saving draft…');
    try {
      const input = { title, caption, hashtags, thumbnailMediaId: thumbnail?.id || null, mediaId: asset.id, platforms: selected, youtubeFormat, videoMetadata, scheduledFor: schedule ? new Date(schedule).toISOString() : undefined };
      let post;
      if (postId) {
        post = await api.updatePost(postId, { ...input, action: action === 'schedule' ? 'schedule' : 'draft' });
        if (action === 'publish') post = await api.publish(postId);
      } else post = await api.createPost({ ...input, action });
      if (post.status === 'failed' || post.status === 'partial') setError(post.lastError || 'One or more platforms failed to publish.');
      else navigate(action === 'schedule' ? '/calendar' : '/library');
    } catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">{postId ? 'RESUME' : 'CREATE'}</span><h1>{postId ? 'Edit Project' : asset ? 'Create from Library' : 'Upload Video'}</h1><p>{postId ? 'Continue editing this saved project.' : 'Create once, then publish the same media across your connected channels.'}</p></div><button className="btn secondary" onClick={() => void submit('draft')} disabled={!!busy || loadingProject}><Save size={17} /> {postId ? 'Save Changes' : 'Save Draft'}</button></div>
      {error && <div className="alert danger">{error}</div>}
      {metaSelected && accounts && !accounts.readiness.publicMediaUrlConfigured && <div className="alert warning"><strong>Meta needs a public media URL.</strong> Use the deployed HTTPS studio to publish to Instagram or Facebook.</div>}
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
              {asset.mimeType.startsWith('video/') ? <video key={asset.id} src={localPreview || asset.localUrl} controls preload="metadata" onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration) || video.duration <= 0) return;
                const metadata = { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
                setVideoMetadata(metadata);
                if (!postId) setYoutubeFormat(shortsEligibility(metadata) ? 'video' : 'short');
              }} /> : <img src={localPreview || asset.localUrl} alt="preview" />}
              <div className="media-preview-bar"><div><strong>{asset.originalName}</strong><span>{(asset.size / 1024 / 1024).toFixed(1)} MB · uploaded</span></div><label className="btn secondary small"><UploadCloud size={15} /> Replace<input type="file" accept="video/*,image/*" hidden onChange={(e) => void chooseFile(e.target.files?.[0])} /></label></div>
            </div>
          )}
          <div className="section-kicker">2 · DETAILS</div>
          <section className="gemini-panel" aria-label="Gemini suggestions" aria-busy={busy.startsWith('Gemini')}>
            <button className="btn secondary" disabled={!!busy || !asset?.mimeType.startsWith('video/') || asset.size > 2 * 1024 ** 3} onClick={() => void analyze()}><Sparkles size={16} />{busy.startsWith('Gemini') ? 'Analyzing video…' : 'Suggest titles & description'}</button>
            <p>Gemini analyzes the video and audio. This sends your video to Google using your saved API key; API charges may apply. Supports videos up to 2 GB. <a href="/settings">Configure key in Settings.</a></p>
            {suggestions && <div className="gemini-suggestions" aria-live="polite">
              <h3>Choose a title</h3>
              {suggestions.titles.map((suggestion, index) => <button className="suggestion-title" key={index} disabled={!!busy} onClick={() => setTitle(suggestion)}>{suggestion}</button>)}
              <h3>Suggested description</h3><p className="suggestion-description">{suggestions.description}</p>
              <button className="btn secondary small" disabled={!!busy} onClick={() => setCaption(suggestions.description)}>Use description</button>
              <p>Review suggestions for accuracy before publishing.</p>
            </div>}
          </section>
          <div className="form-grid">
            <label className="field full"><span>Title</span><input className="input" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="Exploring Japan — A Visual Journey" /><small>{title.length}/100</small></label>
            <label className="field full"><span>Caption / description</span><textarea className="textarea" value={caption} maxLength={5000} onChange={(e) => setCaption(e.target.value)} placeholder="Tell your audience what this video is about…" /><small>{caption.length}/5000</small></label>
            {selected.includes('instagram') && <label className="field full"><span>Instagram hashtags</span><textarea className="textarea compact" value={hashtags} maxLength={1000} onChange={(e) => setHashtags(e.target.value)} placeholder="#reels #video #creator" /><small>{hashtags.length}/1000</small></label>}
          </div>
          {selected.includes('instagram') && <section className="social-assets">
            <div className="social-ai-row"><button className="btn secondary" disabled={!!busy || !title.trim()} onClick={() => void generateHashtags()}><Sparkles size={16}/> Generate hashtags</button><a className="inline-link" href="/settings">Change AI models in Settings →</a></div>
            <div className="thumbnail-copy-editor"><div className="thumbnail-headline-column"><label className="field"><span>Thumbnail headline</span><textarea className="textarea thumbnail-headline-input" maxLength={100} value={generatedThumbnailText} onChange={(e) => setGeneratedThumbnailText(e.target.value)} placeholder="Generate or write a clear, curiosity-driven thumbnail headline" /><small>{generatedThumbnailText.length}/100 · Best at 6–12 words and two lines</small></label>{generatedThumbnailText && <div className={`headline-preview ${youtubeFormat === 'short' ? 'vertical' : ''}`}><span>HEADLINE PREVIEW</span><strong>{generatedThumbnailText}</strong></div>}</div><label className="field"><span>Optional regeneration feedback</span><textarea className="textarea thumbnail-feedback-input" maxLength={500} value={thumbnailFeedback} onChange={(e) => setThumbnailFeedback(e.target.value)} placeholder="Example: Mention the Kerala location and make the result more surprising" /><small>{thumbnailFeedback.length}/500</small></label><div className="thumbnail-copy-actions"><button className="btn secondary" disabled={!!busy || !title.trim()} onClick={() => void generateThumbnailCopy()}><Sparkles size={16}/>{generatedThumbnailText ? 'Regenerate headline' : 'Generate headline'}</button><button className="btn primary" disabled={!!busy || !title.trim() || !generatedThumbnailText.trim()} onClick={() => void generateThumbnail()}><Sparkles size={16}/> Generate thumbnail</button></div></div>
            <div className="reference-picker">{referenceImage && <img src={referenceImage.localUrl} alt="AI reference" />}<div><strong>Optional AI reference image</strong><p>Match its design by default, including layout, font style, colors, spacing, and effects.</p><label className="btn secondary small">Choose reference<input type="file" accept="image/*" hidden onChange={(e) => void chooseReference(e.target.files?.[0])}/></label>{referenceImage && <button className="btn ghost small" onClick={() => setReferenceImage(null)}>Remove</button>}</div>{referenceImage && <label className="field reference-mode"><span>Reference use</span><select className="input" value={referenceMode} onChange={(e) => setReferenceMode(e.target.value as 'preserve' | 'style')}><option value="style">Match design, fonts & colors</option><option value="preserve">Preserve person / product</option></select><small>{referenceMode === 'style' ? 'Uses the image as a strict design template.' : 'Keeps subject identity while allowing a new design.'}</small></label>}</div>
            <div className={`thumbnail-picker ${youtubeFormat === 'short' ? 'vertical' : ''}`}>{thumbnail && <img src={thumbnail.localUrl} alt="Selected thumbnail" />}<div><strong>{youtubeFormat === 'short' ? 'Vertical Short / Reel cover' : 'Horizontal video thumbnail'}</strong><p>{generatedThumbnailText ? `Hook: “${generatedThumbnailText}”` : 'Review a hook above, then generate the thumbnail.'}</p><label className="btn secondary small">Choose image<input type="file" accept="image/*" hidden onChange={(e) => void chooseThumbnail(e.target.files?.[0])}/></label>{thumbnail && <button className="btn ghost small" onClick={() => setThumbnail(null)}>Remove image</button>}</div></div>
          </section>}
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
          {selected.includes('youtube') && <div className="youtube-format">
            <label className="field"><span>YouTube format</span><select className="input" value={youtubeFormat} disabled={!!busy} onChange={(event) => setYoutubeFormat(event.target.value as 'video' | 'short')}><option value="video">Video</option><option value="short">Short</option></select></label>
            <p className="muted">{videoMetadata ? `${videoMetadata.width} × ${videoMetadata.height} · ${videoMetadata.duration.toFixed(1)} seconds` : 'Waiting for readable video dimensions and duration.'}</p>
            {youtubeFormat === 'short' && shortsEligibility(videoMetadata) && <div className="alert warning">{shortsEligibility(videoMetadata)}</div>}
            <p className="muted">YouTube automatically classifies square or vertical videos up to 3 minutes as Shorts. This choice checks eligibility and selects the playback link; it cannot override YouTube’s classification.</p>
          </div>}
          <div className="divider" />
          <div className="section-kicker">4 · PUBLISHING</div>
          <label className="field"><span>Schedule for later</span><input className="input" type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} /></label>
          <button className="btn secondary wide" disabled={!!busy || !schedule} onClick={() => void submit('schedule')}><CalendarClock size={17} /> Schedule Post</button>
          <button className="btn primary wide" disabled={!!busy} onClick={() => void submit('publish')}>{busy ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}{busy || 'Publish Now'}</button>
          <div className="preview-mini"><div className={`preview-screen${asset?.mimeType.startsWith('video/') ? ' video-preview-screen' : ''}`}>{asset ? (asset.mimeType.startsWith('video/') ? <><video src={localPreview || asset.localUrl} muted playsInline preload="metadata" /><span className="play-chip"><Play fill="currentColor" size={13} /></span></> : <img src={localPreview || asset.localUrl} alt="" />) : <div className="preview-placeholder">Preview</div>}</div><strong>{title || 'Your post title'}</strong><span>{caption || 'Your caption will appear here.'}</span></div>
        </aside>
      </div>
    </>
  );
}
