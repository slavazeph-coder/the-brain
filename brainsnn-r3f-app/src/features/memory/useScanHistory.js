import { useCallback, useEffect, useState } from 'react';
import { makeMemoryRecord, loadMemory, saveMemory } from '../../lib/storage.js';

export function useScanHistory() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    setItems(loadMemory());
  }, []);

  const persist = useCallback((next) => {
    const saved = saveMemory(next);
    setItems(saved);
    return saved;
  }, []);

  const addResult = useCallback((result, overrides = {}) => {
    if (!result) return null;
    const record = makeMemoryRecord(result, overrides);
    persist([record, ...items.filter((item) => item.id !== record.id)].slice(0, 80));
    return record;
  }, [items, persist]);

  const addVersion = useCallback((result, content, comparison) => {
    if (!result || !content) return null;
    const current = items.find((item) => item.id === result.id) || makeMemoryRecord(result);
    const nextVersion = {
      id: `${result.id}-v${(current.versions?.length || 1) + 1}`,
      label: `Version ${(current.versions?.length || 1) + 1}`,
      content,
      result: comparison || null,
      savedAt: new Date().toISOString(),
    };
    const updated = {
      ...current,
      updatedAt: new Date().toISOString(),
      versions: [...(current.versions || []), nextVersion],
    };
    persist([updated, ...items.filter((item) => item.id !== updated.id)]);
    return updated;
  }, [items, persist]);

  const remove = useCallback((id) => persist(items.filter((item) => item.id !== id)), [items, persist]);
  const clear = useCallback(() => persist([]), [persist]);

  return { items, addResult, addVersion, remove, clear };
}
