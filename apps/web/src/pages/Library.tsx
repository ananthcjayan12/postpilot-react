import { Edit3, FileImage, FileVideo2, Play, Search, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useVisibleRefresh } from '../lib/poll';
import type { MediaAsset, PostRecord } from '../lib/types';
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
          <div className="media-grid">
            {visible.map((asset) => {
              const post = postByMedia.get(asset.id);
              const resumable = post && ['draft', 'scheduled'].includes(post.status);
              const destination = resumable ? `/create/${post.id}` : `/create?mediaId=${asset.id}`;
              return (
                <article className="media-card" key={asset.id}>
                  <Link className="media-thumb" to={destination} aria-label={resumable ? `Resume ${post.title}` : `Create a project from ${asset.originalName}`}>
                    {asset.mimeType.startsWith('video/') ? (
                      <>
                        <video src={asset.localUrl} muted />
                        <span className="media-play">
                          <Play size={18} fill="currentColor" />
                        </span>
                      </>
                    ) : (
                      <img src={asset.localUrl} alt="" />
                    )}
                    <span className="media-type">
                      {asset.mimeType.startsWith('video/') ? (
                        <FileVideo2 size={13} />
                      ) : (
                        <FileImage size={13} />
                      )}
                      {asset.mimeType.split('/')[0]}
                    </span>
                  </Link>
                  <div className="media-card-body">
                    <div className="media-card-title">
                      <div>
                        <strong><Link to={destination}>{post?.title || asset.originalName}</Link></strong>
                        <span>
                          {new Date(asset.createdAt).toLocaleDateString()} ·{' '}
                          {(asset.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                      </div>
                      <Link className="icon-button ghost" to={destination} title={resumable ? 'Resume project' : 'Use this media'}><Edit3 /></Link>
                    </div>
                    {post ? (
                      <>
                        <StatusPill status={post.status} />
                        {post.lastError && <p className="muted tiny">{post.lastError}</p>}
                        {['failed', 'partial'].includes(post.status) && (
                          <>
                            <button className="btn secondary small" onClick={() => void retry(post.id)}>
                              Retry failed channels
                            </button>
                            <button className="btn secondary small" onClick={() => void review(post)}>
                              Resolve uncertain result
                            </button>
                          </>
                        )}
                        {post.status === 'draft' && (
                          <><Link className="btn secondary small" to={destination}>Resume project</Link><button className="btn secondary small" onClick={() => void publish(post.id)}>Publish draft</button></>
                        )}
                        {post.status === 'scheduled' && <Link className="btn secondary small" to={destination}>Edit scheduled post</Link>}
                      </>
                    ) : (
                      <span className="status-pill draft">
                        <i />
                        asset only
                      </span>
                    )}
                    {!resumable && <Link className="btn secondary small" to={destination}>Use in new project</Link>}
                  </div>
                </article>
              );
            })}
          </div>
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
