import { ArrowRight, CalendarClock, CirclePlay, Eye, FileVideo2, Plus, Send, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlatformBadge } from '../components/PlatformBadge';
import { StatusPill } from '../components/StatusPill';
import { api } from '../lib/api';
import { useVisibleRefresh } from '../lib/poll';
import type { MediaAsset, PostRecord } from '../lib/types';

export function Dashboard() {
  const [posts, setPosts] = useState<PostRecord[]>([]);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  useVisibleRefresh(() => Promise.all([api.posts(), api.media()]).then(([p, m]) => { setPosts(p); setMedia(m); }));
  const published = posts.filter((p) => p.status === 'published').length;
  const scheduled = posts.filter((p) => p.status === 'scheduled').length;
  const failed = posts.filter((p) => p.status === 'failed' || p.status === 'partial').length;
  const mediaMap = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);

  return (
    <>
      <div className="page-heading dashboard-heading">
        <div><span className="eyebrow">CREATOR OVERVIEW</span><h1>Your publishing studio <span className="wave">☀️</span></h1><p>Here’s what’s happening with your publishing workspace.</p></div>
        <Link className="btn primary" to="/create"><Plus size={18} /> Create Post</Link>
      </div>
      <section className="stat-grid">
        <div className="stat-card"><div className="stat-icon blue"><FileVideo2 /></div><div><span>Total Content</span><strong>{posts.length}</strong><small>{media.length} uploaded assets</small></div></div>
        <div className="stat-card"><div className="stat-icon purple"><CalendarClock /></div><div><span>Scheduled</span><strong>{scheduled}</strong><small>Waiting for scheduled publishing</small></div></div>
        <div className="stat-card"><div className="stat-icon green"><Send /></div><div><span>Published</span><strong>{published}</strong><small>Successfully cross-posted jobs</small></div></div>
        <div className="stat-card"><div className="stat-icon amber"><Eye /></div><div><span>Needs attention</span><strong>{failed}</strong><small>Failed or partially published</small></div></div>
      </section>

      <section className="quick-section">
        <div className="section-title"><div><h2>Quick actions</h2><p>Move from idea to published content in a few clicks.</p></div></div>
        <div className="quick-grid">
          <Link to="/create" className="quick-card"><div className="quick-icon"><CirclePlay /></div><div><strong>Upload Video</strong><span>Create a new cross-platform post</span></div><ArrowRight /></Link>
          <Link to="/calendar" className="quick-card"><div className="quick-icon purple"><CalendarClock /></div><div><strong>Schedule Post</strong><span>Plan your next publishing slot</span></div><ArrowRight /></Link>
          <Link to="/accounts" className="quick-card"><div className="quick-icon green"><Send /></div><div><strong>Connect Accounts</strong><span>Authorize YouTube and Meta</span></div><ArrowRight /></Link>
        </div>
      </section>

      <section className="panel recent-panel">
        <div className="section-title"><div><h2>Recent content</h2><p>Your latest drafts, scheduled items and published posts.</p></div><Link to="/library">View library <ArrowRight size={15} /></Link></div>
        {posts.length === 0 ? (
          <div className="empty-state"><Sparkles /><h3>Your studio is ready</h3><p>Upload your first video and PostPilot will keep its publishing state here.</p><Link to="/create" className="btn primary">Create first post</Link></div>
        ) : (
          <div className="content-table">
            {posts.slice(0, 7).map((post) => {
              const asset = mediaMap.get(post.mediaId);
              return <div className="content-row" key={post.id}>
                <div className="thumb small-thumb">{asset?.mimeType.startsWith('video/') ? <video src={asset.localUrl} muted /> : asset ? <img src={asset.localUrl} alt="" /> : <FileVideo2 />}</div>
                <div className="content-main"><strong>{post.title}</strong><span>{new Date(post.createdAt).toLocaleString()}</span></div>
                <div className="platform-stack">{post.platforms.map((p) => <PlatformBadge key={p} platform={p} compact />)}</div>
                <StatusPill status={post.status} />
              </div>;
            })}
          </div>
        )}
      </section>
    </>
  );
}
