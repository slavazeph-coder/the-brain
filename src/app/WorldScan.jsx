import React from 'react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
import { ReconstructPage } from './ReconstructPage.jsx';

export function WorldScan() {
  return (
    <div className="bh-site" data-testid="world-scan">
      <PublicNav active="scan" />
      <ReconstructPage />
      <PublicFooter />
    </div>
  );
}
