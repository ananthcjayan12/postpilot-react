import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, Clock, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlatformBadge } from '../components/PlatformBadge';
import { api } from '../lib/api';
import type { PostRecord } from '../lib/types';

export function CalendarPage() {
  const [month, setMonth] = useState(new Date());
  const [posts, setPosts] = useState<PostRecord[]>([]);
  useEffect(() => { void api.posts().then(setPosts); }, []);
  const days = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(month)), end: endOfWeek(endOfMonth(month)) }), [month]);
  const scheduled = posts.filter((p) => p.scheduledFor);

  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">PLANNER</span><h1>Content Calendar</h1><p>Plan and monitor scheduled publishing across every platform.</p></div><Link className="btn primary" to="/create"><Plus size={17} /> Schedule Post</Link></div>
      <div className="calendar-layout">
        <section className="panel calendar-panel">
          <div className="calendar-toolbar"><div className="month-nav"><button className="icon-button" onClick={() => setMonth(subMonths(month, 1))}><ChevronLeft /></button><h2>{format(month, 'MMMM yyyy')}</h2><button className="icon-button" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight /></button></div><button className="btn secondary small" onClick={() => setMonth(new Date())}>Today</button></div>
          <div className="weekday-row">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => <div key={d}>{d}</div>)}</div>
          <div className="calendar-grid">
            {days.map((day) => {
              const dayPosts = scheduled.filter((p) => p.scheduledFor && isSameDay(new Date(p.scheduledFor), day));
              return <div className={`calendar-cell ${!isSameMonth(day, month) ? 'outside' : ''} ${isSameDay(day, new Date()) ? 'today' : ''}`} key={day.toISOString()}><span className="day-num">{format(day, 'd')}</span><div className="calendar-events">{dayPosts.slice(0, 3).map((p) => <div className="calendar-event" key={p.id}><span>{format(new Date(p.scheduledFor!), 'h:mm a')}</span><strong>{p.title}</strong><div>{p.platforms.slice(0, 3).map((x) => <PlatformBadge key={x} platform={x} compact />)}</div></div>)}{dayPosts.length > 3 && <small>+{dayPosts.length - 3} more</small>}</div></div>;
            })}
          </div>
        </section>
        <aside className="panel upcoming-panel"><div className="section-title"><div><h2>Upcoming posts</h2><p>Your next scheduled jobs.</p></div></div>{scheduled.length ? scheduled.sort((a,b) => +new Date(a.scheduledFor!) - +new Date(b.scheduledFor!)).slice(0,7).map((p) => <div className="upcoming-item" key={p.id}><div className="time-dot"><Clock size={15} /></div><div><strong>{p.title}</strong><span>{format(new Date(p.scheduledFor!), 'MMM d · h:mm a')}</span><div className="platform-stack left">{p.platforms.map((x) => <PlatformBadge key={x} platform={x} compact />)}</div></div></div>) : <div className="empty-compact"><CalendarClockIcon /><strong>No scheduled posts yet</strong><span>Your queue will show here.</span></div>}</aside>
      </div>
    </>
  );
}
function CalendarClockIcon(){ return <div className="empty-icon"><Clock /></div>; }
