import React from 'react';
import { DecoderTranscriptPanel } from './DecoderTranscriptPanel.jsx';
import { ResearchDrawer } from './ResearchDrawer.jsx';

export function ResearchWorkspaceV2() {
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <ResearchDrawer />
      <DecoderTranscriptPanel />
    </div>
  );
}
