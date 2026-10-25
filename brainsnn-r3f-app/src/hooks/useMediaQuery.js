import { useEffect, useState } from 'react';

export function useMediaQuery(queryText) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia(queryText);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, [queryText]);

  return matches;
}
