import { Facebook, Instagram, Youtube } from 'lucide-react';
import type { Platform } from '../lib/types';

const data = {
  youtube: { label: 'YouTube', icon: Youtube },
  instagram: { label: 'Instagram', icon: Instagram },
  facebook: { label: 'Facebook', icon: Facebook }
};

export function PlatformBadge({ platform, compact = false }: { platform: Platform; compact?: boolean }) {
  const item = data[platform];
  const Icon = item.icon;
  return (
    <span className={`platform-badge ${platform} ${compact ? 'compact' : ''}`}>
      <Icon size={compact ? 13 : 15} /> {!compact && item.label}
    </span>
  );
}
