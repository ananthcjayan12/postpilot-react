import { BarChart3, CalendarDays, LayoutDashboard, Library, PlusCircle, Settings, Unplug, UserCircle2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Logo } from './Logo';

const items = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/create', label: 'Create Post', icon: PlusCircle },
  { to: '/calendar', label: 'Content Calendar', icon: CalendarDays },
  { to: '/library', label: 'Content Library', icon: Library },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/accounts', label: 'Accounts', icon: Unplug },
  { to: '/settings', label: 'Settings', icon: Settings }
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo"><Logo /></div>
      <nav className="side-nav">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <div className="creator-card">
        <div className="avatar mini"><UserCircle2 size={24} /></div>
        <div><strong>Creator Studio</strong><span>Cloud workspace</span></div>
      </div>
    </aside>
  );
}
