import type { PostStatus } from '../lib/types';

export function StatusPill({ status }: { status: PostStatus }) {
  return <span className={`status-pill ${status}`}><i />{status}</span>;
}
