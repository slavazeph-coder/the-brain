import React, { useEffect } from 'react';
import { worldDocumentSource } from './worldRoute.js';
/** Keep the standalone editor isolated from the existing Arena and research routes. */
export function WorldHome() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'BrainSNN | World Builder';
    return () => { document.title = previous; };
  }, []);
  return <iframe title="BrainSNN World Builder: capture, edit, simulate and export in one sandbox" src={worldDocumentSource(window.location.search)} allow="camera; clipboard-write" style={{ display: 'block', width: '100%', height: '100dvh', border: 0, background: '#06060a' }} />;
}
