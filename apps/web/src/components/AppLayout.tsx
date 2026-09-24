import { Bell, Search, Sparkles } from 'lucide-react';
import { Outlet, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, type Session } from '../lib/api';
import { Sidebar } from './Sidebar';

export function AppLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    void api
      .session()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (!session) return;
    let stopped = false,
      busy = false;
    const previous = new Map<string, string>();
    const refresh = async () => {
      if (stopped || busy || document.hidden) return;
      busy = true;
      try {
        const settings = await api.settings();
        if (!settings.notify) return;
        const posts = await api.posts();
        for (const post of posts) {
          if (
            previous.get(post.id) === 'publishing' &&
            ['published', 'partial', 'failed'].includes(post.status)
          )
            setNotice(
              `${post.title}: ${post.status === 'published' ? 'published successfully' : 'publishing finished; check the library for details'}.`,
            );
          previous.set(post.id, post.status);
        }
      } catch {
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = setInterval(refresh, 30000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [session]);
  if (!loaded) return <div className="page-wrap">Loading your studio…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <header className="topbar">
          <div className="search-box">
            <Search size={17} />
            <input placeholder="Search content, posts, or media..." />
          </div>
          <div className="topbar-actions">
            <button className="icon-button" title="Notifications">
              <Bell size={18} />
            </button>
            <div className="top-profile">
              <div className="avatar">{session.user.name[0]}</div>
              <div>
                <strong>{session.user.name}</strong>
                <button className="btn secondary small" onClick={() => void api.logout()}>
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </header>
        <main className="page-wrap">
          {notice && (
            <div className="alert" role="status">
              {notice}
              <button className="btn secondary small" onClick={() => setNotice('')}>
                Dismiss
              </button>
            </div>
          )}
          <Outlet />
        </main>
        <footer className="app-footer">
          <Sparkles size={14} /> PostPilot · publishing studio
        </footer>
      </div>
    </div>
  );
}
