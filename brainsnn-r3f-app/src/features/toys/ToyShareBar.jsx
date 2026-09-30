// One-tap sharing for the score-card toys: make the card, hand it over, copy
// the caption. Same delivery rules as the poke clip — share sheet on phones,
// download plus caption on the clipboard everywhere else.
import React, { useState } from 'react';
import { Copy, ImageDown } from 'lucide-react';
import { track } from '../../lib/analytics.js';
import { copyText, fontsReady, renderScoreCard, shareOrDownload } from './shareMedia.js';
import { getToy, sponsorFor, toyCaption, toyFileName, toyShareUrl } from './toyConfig.js';

export function ToyShareBar({ toyId, card, result, params }) {
  const toy = getToy(toyId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const caption = toyCaption(toyId, { result, params });

  async function shareCard() {
    setBusy(true);
    try {
      await fontsReady();
      const blob = await renderScoreCard({
        toyTitle: toy.title,
        hook: toy.hook,
        url: toyShareUrl(toyId, { params }),
        sponsor: sponsorFor(toyId),
        ...card,
      });
      const via = await shareOrDownload({ blob, filename: toyFileName(toyId, 'score', 'png'), title: toy.title, caption });
      track('toy_card_saved', { toy: toyId, via });
      setMessage(via === 'shared' ? 'Shared.' : via === 'downloaded' ? 'Card saved — caption and link copied.' : 'Share cancelled.');
    } catch {
      setMessage('Could not make the card in this browser. Copy the link instead.');
    } finally {
      setBusy(false);
    }
  }

  async function copyCaption() {
    const ok = await copyText(caption);
    track('toy_link_copied', { toy: toyId });
    setMessage(ok ? 'Caption and link copied.' : `Clipboard blocked — the link is ${toyShareUrl(toyId, { params })}`);
  }

  return (
    <div className="toy-share-bar" data-testid={`${toyId}-share`}>
      <button type="button" className="bh-button bh-primary" onClick={shareCard} disabled={busy}>
        <ImageDown size={16} aria-hidden="true" /> {busy ? 'Making the card…' : 'Share score card'}
      </button>
      <button type="button" className="bh-button bh-secondary" onClick={copyCaption}>
        <Copy size={16} aria-hidden="true" /> Copy caption and link
      </button>
      <p className="toy-share-message" role="status">{message}</p>
    </div>
  );
}
