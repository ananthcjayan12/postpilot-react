import { Play } from 'lucide-react';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-lockup">
      <span className="brand-mark"><Play size={15} fill="currentColor" strokeWidth={2.5} /></span>
      {!compact && <span className="brand-name">PostPilot</span>}
    </div>
  );
}
