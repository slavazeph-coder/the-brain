import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLabSummary, unavailableSummary } from './agentLabModel.js';

export function useLabSummary() {
  const [summary, setSummary] = useState(unavailableSummary);
  const [loading, setLoading] = useState(true);
  const current = useRef(null);

  const refresh = useCallback(async () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setLoading(true);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const next = await fetchLabSummary({ signal: controller.signal });
      if (current.current === controller) setSummary(next);
    } catch {
      if (current.current === controller) setSummary(unavailableSummary());
    } finally {
      clearTimeout(timeout);
      if (current.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      const controller = current.current;
      current.current = null;
      controller?.abort();
    };
  }, [refresh]);

  return { summary, loading, refresh };
}
