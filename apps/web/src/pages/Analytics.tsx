import { AlertTriangle, CalendarCheck2, CheckCircle2, Layers3 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';

export function Analytics() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { void api.analytics().then(setData); }, []);
  const timeline = useMemo(() => {
    if (!data?.recent) return [];
    const map = new Map<string, { date: string; published: number; scheduled: number }>();
    for (const item of data.recent) {
      const current = map.get(item.date) || { date: item.date, published: 0, scheduled: 0 };
      current.published += item.published;
      current.scheduled += item.scheduled;
      map.set(item.date, current);
    }
    return [...map.values()];
  }, [data]);
  const platformBars = data ? [
    { name: 'YouTube', posts: data.platforms.youtube },
    { name: 'Instagram', posts: data.platforms.instagram },
    { name: 'Facebook', posts: data.platforms.facebook }
  ] : [];
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">INSIGHTS</span><h1>Analytics</h1><p>Local publishing analytics that require no additional platform permissions.</p></div></div>
      <section className="stat-grid">
        <div className="stat-card"><div className="stat-icon blue"><Layers3 /></div><div><span>Total jobs</span><strong>{data?.total ?? 0}</strong><small>Drafts, scheduled and published</small></div></div>
        <div className="stat-card"><div className="stat-icon green"><CheckCircle2 /></div><div><span>Published</span><strong>{data?.counts?.published ?? 0}</strong><small>All selected channels succeeded</small></div></div>
        <div className="stat-card"><div className="stat-icon purple"><CalendarCheck2 /></div><div><span>Scheduled</span><strong>{data?.counts?.scheduled ?? 0}</strong><small>Waiting for scheduled publishing</small></div></div>
        <div className="stat-card"><div className="stat-icon amber"><AlertTriangle /></div><div><span>Needs attention</span><strong>{(data?.counts?.failed ?? 0) + (data?.counts?.partial ?? 0)}</strong><small>Failed or partially published jobs</small></div></div>
      </section>
      <div className="analytics-grid">
        <section className="panel chart-panel"><div className="section-title"><div><h2>Publishing activity</h2><p>Recent jobs created in this workspace.</p></div></div><div className="chart-wrap">{timeline.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={timeline}><defs><linearGradient id="pubFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={0.32}/><stop offset="95%" stopColor="#2563eb" stopOpacity={0.02}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf6"/><XAxis dataKey="date" tickLine={false} axisLine={false}/><YAxis allowDecimals={false} tickLine={false} axisLine={false}/><Tooltip/><Legend/><Area type="monotone" dataKey="published" stroke="#2563eb" fill="url(#pubFill)" strokeWidth={3}/><Area type="monotone" dataKey="scheduled" stroke="#8b5cf6" fill="transparent" strokeWidth={2}/></AreaChart></ResponsiveContainer> : <div className="chart-empty">Create posts to populate the chart.</div>}</div></section>
        <section className="panel chart-panel"><div className="section-title"><div><h2>Platform mix</h2><p>How many jobs target each channel.</p></div></div><div className="chart-wrap">{data?.total ? <ResponsiveContainer width="100%" height="100%"><BarChart data={platformBars}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf6"/><XAxis dataKey="name" tickLine={false} axisLine={false}/><YAxis allowDecimals={false} tickLine={false} axisLine={false}/><Tooltip/><Bar dataKey="posts" radius={[8,8,0,0]} fill="#2563eb" /></BarChart></ResponsiveContainer> : <div className="chart-empty">No platform data yet.</div>}</div></section>
      </div>
      <div className="alert info"><strong>Why no views/likes here?</strong> PostPilot intentionally avoids extra analytics permissions. This page tracks publishing activity only, keeping the OAuth surface as small as possible. You can add platform insights later if you decide you want those permissions.</div>
    </>
  );
}
