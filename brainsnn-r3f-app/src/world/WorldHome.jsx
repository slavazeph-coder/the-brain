import React, { useEffect, useRef, useState } from 'react';
import { publicWorldFragment, worldDocumentSource } from './worldRoute.js';

/** Keep the standalone editor isolated from the existing Arena and research routes. */
export function WorldHome() {
  const frame = useRef(null);
  const [initialSource] = useState(() => worldDocumentSource(window.location.search, window.location.hash));

  useEffect(() => {
    const previous = document.title;
    document.title = 'BrainSNN | World Builder';

    function followAddress() {
      const { hash, search } = window.location;
      const destination = publicWorldFragment(hash);
      const editor = frame.current;
      if (!editor || (hash && !destination)) return;
      const current = editor.contentDocument?.location;
      if (current?.pathname !== '/world/index.html') {
        editor.src = worldDocumentSource(search, hash);
        return;
      }

      // Move within the current native document. Its scene query and edits stay
      // intact, and the parent's Back button has just one entry per navigation.
      if (current.hash !== destination) {
        const next = new URL(current.href);
        next.hash = destination || '#';
        current.replace(next.href);
      }
    }

    window.addEventListener('hashchange', followAddress);
    return () => {
      document.title = previous;
      window.removeEventListener('hashchange', followAddress);
    };
  }, []);

  return <iframe ref={frame} title="BrainSNN World Builder: capture, edit, simulate and export in one sandbox" src={initialSource} allow="camera; clipboard-write" style={{ display: 'block', width: '100%', height: '100dvh', border: 0, background: '#06060a' }} />;
}
