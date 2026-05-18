import React, { useEffect, useState } from 'react';
import { startSwUpdateWatch, subscribeSwUpdate, activateNewSw } from '../utils/swUpdate';

/**
 * UpdateBanner — small chip in the bottom-right that appears when a
 * new service worker is waiting. Click "Reload" to skipWaiting + boot
 * against the new chunks. Dismissible until the next update.
 */
export default function UpdateBanner() {
  const [waiting, setWaiting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    startSwUpdateWatch();
    return subscribeSwUpdate((state) => {
      if (state.status === 'waiting') {
        setWaiting(true);
        setDismissed(false);  // re-show after each new update
      }
    });
  }, []);

  if (!waiting || dismissed) return null;

  return (
    <div className="shell-update-banner" role="status" aria-live="polite">
      <span className="shell-update-banner-msg">A new version is ready.</span>
      <button
        className="shell-update-banner-action"
        onClick={() => activateNewSw()}
      >
        Reload
      </button>
      <button
        className="shell-update-banner-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
      >×</button>
    </div>
  );
}
