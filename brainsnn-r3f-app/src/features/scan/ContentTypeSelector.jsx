import React from 'react';
import { FileText, Link2, Video } from 'lucide-react';
import { SegmentedControl } from '../../components/ui/SegmentedControl.jsx';

const options = [
  { value: 'text', label: 'Text', icon: FileText },
  { value: 'webpage', label: 'Web page beta', icon: Link2 },
  { value: 'script', label: 'Video/script beta', icon: Video },
];

export function ContentTypeSelector({ value, onChange }) {
  return (
    <div>
      <SegmentedControl label="Input type" options={options} value={value} onChange={onChange} />
      {value !== 'text' ? (
        <p className="bsn-note">Beta mode currently analyzes the pasted URL, page text, transcript, or script you provide. It does not extract remote media automatically.</p>
      ) : null}
    </div>
  );
}
