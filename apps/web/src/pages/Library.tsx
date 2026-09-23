import { FileImage, FileVideo2, MoreHorizontal, Play, Search, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { MediaAsset, PostRecord } from '../lib/types';
import { StatusPill } from '../components/StatusPill';

export function Library() {
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [posts, setPosts] = useState<PostRecord[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => { void Promise.all([api.media(), api.posts()]).then(([m,p]) => { setMedia(m); setPosts(p); }); }, []);
  const postByMedia = useMemo(() => new Map(posts.map((p) => [p.mediaId, p])), [posts]);
  const visible = media.filter((m) => m.originalName.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">ASSETS</span><h1>Content Library</h1><p>All your uploaded media and publishing states in one place.</p></div><Link to="/create" className="btn primary"><Upload size={17} /> Upload New</Link></div>
      <section className="panel library-panel">
        <div className="library-toolbar"><div className="search-box inline"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search media..." /></div><div className="filter-tabs"><button className="active">All media</button><button>Videos</button><button>Images</button></div></div>
        {visible.length ? <div className="media-grid">{visible.map((asset) => { const post = postByMedia.get(asset.id); return <article className="media-card" key={asset.id}><div className="media-thumb">{asset.mimeType.startsWith('video/') ? <><video src={asset.localUrl} muted /><span className="media-play"><Play size={18} fill="currentColor" /></span></> : <img src={asset.localUrl} alt="" />}<span className="media-type">{asset.mimeType.startsWith('video/') ? <FileVideo2 size={13} /> : <FileImage size={13} />}{asset.mimeType.split('/')[0]}</span></div><div className="media-card-body"><div className="media-card-title"><div><strong>{post?.title || asset.originalName}</strong><span>{new Date(asset.createdAt).toLocaleDateString()} · {(asset.size/1024/1024).toFixed(1)} MB</span></div><button className="icon-button ghost"><MoreHorizontal /></button></div>{post ? <StatusPill status={post.status} /> : <span className="status-pill draft"><i />asset only</span>}</div></article>; })}</div> : <div className="empty-state"><Upload /><h3>No media found</h3><p>Upload a video or image to start building your library.</p><Link className="btn primary" to="/create">Upload media</Link></div>}
      </section>
    </>
  );
}
