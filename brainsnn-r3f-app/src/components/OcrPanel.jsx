import React, { useEffect, useRef, useState } from 'react';
import { ocrImage, imageFromClipboard } from '../utils/ocr';

/**
 * Layer 58 — Image OCR Firewall panel.
 *
 * Drop or paste a screenshot, get OCRed text + a "Scan in Firewall"
 * handoff that deep-links into the Cognitive Firewall via
 * /?scan=<text>.
 */
export default function OcrPanel() {
  const [preview, setPreview] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const fileInputRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    function onPaste(e) {
      const file = imageFromClipboard(e);
      if (file) { e.preventDefault(); handleFile(file); }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFile(file) {
    if (!file) return;
    setErr(''); setText(''); setStatus('Loading…'); setProgress(0);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      setPreview(dataUrl);
      setStatus('OCR running…');
      const { text: ocrText, confidence } = await ocrImage(file, {
        onProgress: (p) => setProgress(Math.round(p * 100)),
      });
      setText(ocrText);
      setStatus(`OCR done — confidence ${Math.round(confidence)}%`);
    } catch (e) {
      setErr(e.message || 'OCR failed');
      setStatus('');
    }
  }

  function onDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  }

  function sendToFirewall() {
    if (!text.trim()) return;
    const target = `${window.location.origin}/?scan=${encodeURIComponent(text.slice(0, 4000))}`;
    window.location.href = target;
  }

  return (
    <section className="panel panel-pad ocr-panel">
      <div className="eyebrow">Layer 58 · image OCR</div>
      <h2>Drop a screenshot</h2>
      <p className="muted">
        Paste an image from your clipboard, drop a PNG / JPG, or pick a file.
        OCR runs entirely in your browser (tesseract.js, lazy-loaded on
        first use — ~7 MB model download once). The extracted text gets
        piped into the Cognitive Firewall.
      </p>

      <div
        ref={dropRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        style={{
          marginTop: 10,
          padding: '24px 16px',
          borderRadius: 10,
          border: '2px dashed rgba(90,212,255,0.4)',
          background: 'rgba(90,212,255,0.04)',
          cursor: 'pointer',
          textAlign: 'center',
          color: '#cbd5e1',
        }}
      >
        <p style={{ margin: 0, fontWeight: 600 }}>
          Click, drop an image, or press ⌘V / Ctrl-V anywhere on the page
        </p>
        <p className="muted small-note" style={{ marginTop: 6 }}>
          Stays in-browser. Nothing leaves your machine.
        </p>
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          onChange={(e) => handleFile(e.target.files?.[0])}
          style={{ display: 'none' }}
        />
      </div>

      {preview && (
        <div style={{ marginTop: 10 }}>
          <img
            src={preview}
            alt="pasted"
            style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}
          />
        </div>
      )}

      {(status || progress > 0) && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted small-note">{status}</span>
            <span className="muted small-note">{progress}%</span>
          </div>
          <div style={{ width: '100%', height: 6, background: '#1a1f2e', borderRadius: 999, marginTop: 4 }}>
            <div style={{ width: `${progress}%`, height: '100%', background: '#5ad4ff', borderRadius: 999, transition: 'width 180ms ease' }} />
          </div>
        </div>
      )}

      {err && <p className="muted" style={{ color: '#dd6974', marginTop: 8 }}>Error: {err}</p>}

      {text && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow">Extracted text</div>
          <textarea
            className="firewall-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            style={{ marginTop: 6 }}
          />
          <div className="control-actions" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={sendToFirewall}>
              Scan in Firewall →
            </button>
            <button
              className="btn"
              onClick={() => navigator.clipboard?.writeText(text).catch(() => {})}
            >
              Copy text
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
