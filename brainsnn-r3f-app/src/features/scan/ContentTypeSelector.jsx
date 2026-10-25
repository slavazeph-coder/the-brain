import React from 'react';
import { BrainCircuit, FileText, Link2, Video } from 'lucide-react';
import { SegmentedControl } from '../../components/ui/SegmentedControl.jsx';

const options = [
  { value: 'text', label: 'Text', icon: FileText },
  { value: 'webpage', label: 'Web page', icon: Link2 },
  { value: 'video', label: 'Video / screen', icon: Video },
  { value: 'neural', label: 'Neural transcript', icon: BrainCircuit },
];

const notes = {
  webpage: 'Paste a URL or the page text. Remote page extraction remains beta, so pasted copy is the most reliable input.',
  video: 'Upload a local video or screen recording. V0 samples visual-change signals in your browser and fuses them with optional transcript or notes; the raw video is not uploaded.',
  neural: 'Experimental L19 replay mode. Paste decoded text from an authorized EEG/MEG/neural decoder; BrainSNN analyzes the decoder output, not raw neural signals.',
};

export function ContentTypeSelector({ value, onChange }) {
  const normalized = value === 'script' ? 'video' : value;
  return (
    <div>
      <SegmentedControl label="Input type" options={options} value={normalized} onChange={onChange} />
      {notes[normalized] ? <p className="bsn-note input-type-note">{notes[normalized]}</p> : null}
    </div>
  );
}
