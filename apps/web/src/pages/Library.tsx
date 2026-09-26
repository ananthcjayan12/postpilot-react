import { Edit3, FileImage, FileVideo2, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useVisibleRefresh } from '../lib/poll';
import type { MediaAsset, Platform, PostRecord } from '../lib/types';
import { StatusPill } from '../components/StatusPill';

export function Library() {
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [posts, setPosts] = useState<PostRecord[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const retry = async (id: string) => {
    try {
      await api.retry(id);
      setPosts(await api.posts());
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const publish = async (id: string) => {
    if (!window.confirm('Publish this draft now?')) return;
    try {
      await api.publish(id);
      setPosts(await api.posts());
    } catch (e: any) {
      setError(e.message);
    }
  };
  const removeProvider = async (post: PostRecord, platform: Platform) => {
    if (!window.confirm(`Delete this video from ${platform}? This cannot be undone.`)) return;
    try { await api.deleteProviderPost(post.id, platform); setPosts(await api.posts()); setError(''); }
    catch (e: any) { setError(e.message); }
  };
  const removeMedia = async (asset: MediaAsset) => {
    if (!window.confirm(`Delete ${asset.originalName} from R2 storage? Any projects using this file will also be removed. This cannot be undone.`)) return;
    try { await api.deleteMedia(asset.id); setMedia(await api.media()); setError(''); }
    catch (e: any) { setError(e.message); }
  };
  useVisibleRefresh(() =>
    Promise.all([api.media(), api.posts()]).then(([m, p]) => {
      setMedia(m);
      setPosts(p);
    }),
  );
  const review = async (post: PostRecord) => {
    const platform = window.prompt('Which platform did you inspect? youtube, instagram, or facebook');
    if (!platform || !post.platforms.includes(platform as any)) return;
    const answer = window.prompt(
      'After checking the provider account, enter its published post/video ID, or type NOT PUBLISHED if you confirmed it is absent. Cancel if uncertain.',
    );
    if (!answer) return;
    if (
      !window.confirm(
        'Confirm you checked the provider account. Incorrect confirmation can cause duplicate publishing.',
      )
    )
      return;
    try {
      await api.resolve(
        post.id,
        platform as any,
        answer === 'NOT PUBLISHED' ? 'not_published' : 'published',
        answer === 'NOT PUBLISHED' ? undefined : answer,
      );
      setPosts(await api.posts());
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  };
  const postByMedia = useMemo(() => new Map([...posts].reverse().map((p) => [p.mediaId, p])), [posts]);
  const visible = media.filter((m) => m.originalName.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      {error && <div className="alert danger">{error}</div>}
      <div className="page-heading">
        <div>
          <span className="eyebrow">ASSETS</span>
          <h1>Content Library</h1>
          <p>All your uploaded media and publishing states in one place.</p>
        </div>
        <Link to="/create" className="btn primary">
          <Upload size={17} /> Upload New
        </Link>
      </div>
      <section className="panel library-panel">
        <div className="library-toolbar">
          <div className="search-box inline">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search media..." />
          </div>
          <div className="filter-tabs">
            <button className="active">All media</button>
            <button>Videos</button>
            <button>Images</button>
          </div>
        </div>
        {visible.length ? (
          <div className="library-table-wrap"><table className="library-table">
            <thead><tr><th>Media</th><th>Project</th><th>YouTube</th><th>Instagram</th><th>Facebook</th><th>Actions</th></tr></thead>
            <tbody>
            {visible.map((asset) => {
              const post = postByMedia.get(asset.id);
              const resumable = post && ['draft', 'scheduled'].includes(post.status);
              const destination = resumable ? `/create/${post.id}` : `/create?mediaId=${asset.id}`;
              return (
                <tr key={asset.id}>
                  <td><Link className="table-media" to={destination} aria-label={resumable ? `Resume ${post.title}` : `Create a project from ${asset.originalName}`}>
                    {asset.mimeType.startsWith('video/') ? (
                      <video src={asset.localUrl} muted />
                    ) : (
                      <img src={asset.localUrl} alt="" />
                    )}
                  </Link><span className="table-file">{asset.mimeType.startsWith('video/') ? <FileVideo2/> : <FileImage/>}<span>{asset.originalName}<small>{(asset.size / 1024 / 1024).toFixed(1)} MB · {new Date(asset.createdAt).toLocaleDateString()}</small></span></span></td>
                  <td>{post ? <><strong><Link to={destination}>{post.title}</Link></strong><StatusPill status={post.status}/></> : <span className="status-pill draft"><i/>asset only</span>}</td>
                  {(['youtube','instagram','facebook'] as Platform[]).map((platform) => {
                    const status = post?.targetStatuses?.[platform];
                    return <td key={platform}>{status ? <><StatusPill status={status === 'success' ? 'published' : status as any}/>{status === 'success' && <button className="icon-button danger" title={`Delete from ${platform}`} onClick={() => void removeProvider(post!, platform)}><Trash2/></button>}</> : <span className="muted tiny">—</span>}</td>;
                  })}
                  <td><div className="table-actions"><Link className="icon-button ghost" to={destination} title={resumable ? 'Resume project' : 'Use media'}><Edit3/></Link><button className="icon-button danger" title="Delete from R2" onClick={() => void removeMedia(asset)}><Trash2/></button></div>
                    {post && ['failed','partial'].includes(post.status) && <><button className="btn secondary small" onClick={() => void retry(post.id)}>Retry</button><button className="btn secondary small" onClick={() => void review(post)}>Review</button></>}
                    {post?.status === 'draft' && <button className="btn secondary small" onClick={() => void publish(post.id)}>Publish</button>}
                  </td>
                </tr>
              );
            })}
            </tbody></table></div>
        ) : (
          <div className="empty-state">
            <Upload />
            <h3>No media found</h3>
            <p>Upload a video or image to start building your library.</p>
            <Link className="btn primary" to="/create">
              Upload media
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
