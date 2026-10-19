import React, { useEffect } from 'react';
/** Keep the standalone editor isolated from the existing Arena and research routes. */
export function WorldHome() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'BrainSNN | World Builder';
    return () => { document.title = previous; };
  }, []);
  return <iframe title="BrainSNN World Builder: capture, review, plan and keep the evidence" src="/world/index.html" allow="camera" style={{ display: 'block', width: '100%', height: '100dvh', border: 0, background: '#06060a' }} />;
}
