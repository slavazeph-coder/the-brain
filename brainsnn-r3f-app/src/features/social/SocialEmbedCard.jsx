import React, { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';

// Instagram Reels (and similar) embeds, loaded via a click-to-load facade so
// no third-party script or iframe touches the page until the visitor opts in.
// Add entries here and the "See it in action" landing section appears; leave
// the list empty and the section renders nothing.
export const SOCIAL_EMBEDS = [
  // { platform: 'instagram', url: 'https://www.instagram.com/reel/XXXXXXXXX/', title: 'BrainSNN scanning a viral hook' },
];

function loadInstagramScript() {
  if (window.instgrm?.Embeds) {
    window.instgrm.Embeds.process();
    return;
  }
  if (document.querySelector('script[src*="instagram.com/embed.js"]')) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.instagram.com/embed.js';
  document.body.appendChild(script);
}

export function SocialEmbedCard({ embed }) {
  const [activated, setActivated] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!activated || embed.platform !== 'instagram') return;
    loadInstagramScript();
    // Cap retries: if the script is blocked (adblock/offline) the poll must
    // not spin forever.
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (window.instgrm?.Embeds) {
        window.instgrm.Embeds.process();
        window.clearInterval(timer);
      } else if (attempts >= 30) {
        window.clearInterval(timer);
      }
    }, 400);
    return () => window.clearInterval(timer);
  }, [activated, embed.platform]);

  if (!activated) {
    return (
      <button type="button" className="social-embed-facade" onClick={() => setActivated(true)}>
        <span className="social-embed-play"><Play size={22} aria-hidden="true" /></span>
        <strong>{embed.title}</strong>
        <small>Tap to load from {embed.platform === 'instagram' ? 'Instagram' : embed.platform} — loads their player and cookies</small>
      </button>
    );
  }

  if (embed.platform === 'instagram') {
    return (
      <div ref={containerRef} className="social-embed-live">
        <blockquote
          className="instagram-media"
          data-instgrm-permalink={embed.url}
          data-instgrm-version="14"
          style={{ background: 'transparent', width: '100%', minHeight: 480 }}
        >
          <a href={embed.url} target="_blank" rel="noreferrer noopener">{embed.title}</a>
        </blockquote>
      </div>
    );
  }

  return (
    <a className="social-embed-facade" href={embed.url} target="_blank" rel="noreferrer noopener">
      <strong>{embed.title}</strong>
    </a>
  );
}
