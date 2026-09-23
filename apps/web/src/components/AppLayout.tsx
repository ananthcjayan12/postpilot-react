import { Bell, Search, Sparkles } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function AppLayout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <header className="topbar">
          <div className="search-box"><Search size={17} /><input placeholder="Search content, posts, or media..." /></div>
          <div className="topbar-actions">
            <button className="icon-button" title="Notifications"><Bell size={18} /></button>
            <div className="top-profile"><div className="avatar">A</div><div><strong>Alex Carter</strong><span>Creator</span></div></div>
          </div>
        </header>
        <main className="page-wrap"><Outlet /></main>
        <footer className="app-footer"><Sparkles size={14} /> PostPilot · local-first publishing studio</footer>
      </div>
    </div>
  );
}
