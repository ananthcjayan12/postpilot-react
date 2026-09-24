import { useEffect } from 'react';
// Callbacks should be stable or capture only state setters. No requests while hidden.
export function useVisibleRefresh(refresh: () => Promise<unknown>, interval = 15000) {
  useEffect(() => {
    let stopped = false,
      busy = false;
    const run = async () => {
      if (stopped || busy || document.hidden) return;
      busy = true;
      try {
        await refresh();
      } catch {
        /* API handles expired sessions; next refresh retries transient failures. */
      } finally {
        busy = false;
      }
    };
    const visible = () => {
      void run();
    };
    const timer = setInterval(run, interval);
    void run();
    document.addEventListener('visibilitychange', visible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
}
