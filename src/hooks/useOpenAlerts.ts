import { useEffect, useState } from 'react';
import { useData, LIVE_REFRESH_MINUTES } from '../state/DataContext';

/** Count of unacknowledged alerts (live modes only; null in demo or before the first load). */
export function useOpenAlerts(): number | null {
  const { mode } = useData();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (mode === 'demo') return;
    let cancelled = false;
    let detach = () => {};
    (async () => {
      const svc = await import('../data/alertsService');
      const load = async () => {
        try {
          const n = await svc.countOpenAlerts();
          if (!cancelled) setCount(n);
        } catch {
          if (!cancelled) setCount(null);
        }
      };
      if (cancelled) return;
      void load();
      const id = window.setInterval(() => void load(), LIVE_REFRESH_MINUTES * 60_000);
      const onChange = () => void load();
      window.addEventListener(svc.ALERTS_CHANGED_EVENT, onChange);
      detach = () => {
        window.clearInterval(id);
        window.removeEventListener(svc.ALERTS_CHANGED_EVENT, onChange);
      };
    })();
    return () => {
      cancelled = true;
      detach();
    };
  }, [mode]);

  return count;
}
