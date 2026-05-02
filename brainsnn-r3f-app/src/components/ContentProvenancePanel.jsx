import React, { useEffect, useMemo, useState } from 'react';
import {
  isCryptoAvailable,
  ensureIdentity,
  loadIdentity,
  loadHandle,
  setHandle,
  fingerprintFor,
  signContent,
  appendEdit,
  verifyManifest,
  recentManifestLog,
  logManifest,
  clearManifestLog,
  manifestToShareString,
  tryParseManifest,
  humanityScore,
} from '../utils/contentProvenance';

/**
 * Layer 101 — Content Verification System panel.
 *
 * Three tabs:
 *   - Sign:   capture context, sign payload, output a manifest
 *   - Verify: paste a manifest + payload, get pass/fail + chain view
 *   - Humanity: run the heuristic humanity score on a draft
 *
 * The whole thing runs in-browser — keys never leave the device.
 */
export default function ContentProvenancePanel() {
  const supported = isCryptoAvailable();
  const [tab, setTab] = useState('sign');
  const [identity, setIdentity] = useState(() => loadIdentity());
  const [handle, setHandleState] = useState(() => loadHandle());
  const [fp, setFp] = useState('');

  useEffect(() => {
    let alive = true;
    if (identity?.pub) {
      fingerprintFor(identity.pub).then((f) => { if (alive) setFp(f); });
    }
    return () => { alive = false; };
  }, [identity]);

  async function handleGenerate() {
    if (!supported) return;
    const r = await ensureIdentity({ handle });
    if (r.ok) {
      setIdentity(loadIdentity());
      setFp(r.identity.fingerprint);
    }
  }

  function handleHandleChange(e) {
    const v = e.target.value;
    setHandleState(v);
    setHandle(v);
  }

  return (
    <section className="panel panel-pad content-provenance-panel">
      <div className="eyebrow">Layer 101 · content verification</div>
      <h2>Sign your humanity</h2>
      <p className="muted">
        AI-perfect imagery is now cheap. The signal that cuts through is
        a verifiable chain of custody — who captured it, on what device,
        and which edits followed. Sign your content with a local keypair.
        Anyone can verify your post hasn't been swapped for a fake.
      </p>

      <IdentityCard
        supported={supported}
        identity={identity}
        fingerprint={fp}
        handle={handle}
        onHandle={handleHandleChange}
        onGenerate={handleGenerate}
      />

      <div className="control-actions" style={{ marginTop: 14, gap: 6 }}>
        <Tab id="sign" tab={tab} setTab={setTab} label="Sign" />
        <Tab id="verify" tab={tab} setTab={setTab} label="Verify" />
        <Tab id="humanity" tab={tab} setTab={setTab} label="Humanity" />
        <Tab id="log" tab={tab} setTab={setTab} label="Log" />
      </div>

      {tab === 'sign' && <SignTab supported={supported} identity={identity} />}
      {tab === 'verify' && <VerifyTab supported={supported} />}
      {tab === 'humanity' && <HumanityTab />}
      {tab === 'log' && <LogTab />}
    </section>
  );
}

function Tab({ id, tab, setTab, label }) {
  const on = tab === id;
  return (
    <button
      className={on ? 'btn-sm' : 'ghost small'}
      onClick={() => setTab(id)}
      style={on ? {} : { opacity: 0.7 }}
    >
      {label}
    </button>
  );
}

function IdentityCard({ supported, identity, fingerprint, handle, onHandle, onGenerate }) {
  if (!supported) {
    return (
      <div
        style={{
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgba(221,105,116,0.08)',
          borderLeft: '3px solid #dd6974',
          marginTop: 10,
        }}
      >
        <strong>Web Crypto unavailable.</strong>
        <p className="muted small-note" style={{ margin: '4px 0 0' }}>
          Signing needs SubtleCrypto, which requires HTTPS or localhost.
          The Humanity tab still works.
        </p>
      </div>
    );
  }

  const hasIdentity = !!identity?.priv && !!identity?.pub;
  const tone = hasIdentity ? '#5ee69a' : '#fdab43';

  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: 8,
        background: `${tone}14`,
        borderLeft: `3px solid ${tone}`,
        marginTop: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>{hasIdentity ? 'Creator key ready' : 'No creator key yet'}</strong>
        <span className="muted small-note">
          {hasIdentity ? 'ECDSA P-256 · stored locally' : 'click to generate'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 8 }}>
        <input
          className="share-input"
          type="text"
          placeholder="@handle (optional, embedded in manifests)"
          value={handle || ''}
          onChange={onHandle}
          maxLength={40}
        />
        <button className="btn-sm" onClick={onGenerate}>
          {hasIdentity ? 'Rotate key' : 'Generate key'}
        </button>
      </div>
      {fingerprint && (
        <p className="muted small-note" style={{ marginTop: 6, fontFamily: 'monospace' }}>
          fp · {fingerprint.slice(0, 16)}…
        </p>
      )}
    </div>
  );
}

function SignTab({ supported, identity }) {
  const [payload, setPayload] = useState('');
  const [device, setDevice] = useState('');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [manifest, setManifest] = useState(null);
  const [editNote, setEditNote] = useState('');
  const [err, setErr] = useState('');

  const ready = supported && identity?.priv;

  async function doSign() {
    setErr('');
    if (!ready) { setErr('Generate a key first'); return; }
    if (!payload.trim()) { setErr('Paste content to sign'); return; }
    const r = await signContent({
      payload,
      payloadKind: 'text',
      device,
      location,
      note,
    });
    if (!r.ok) { setErr(r.reason || 'sign failed'); return; }
    setManifest(r.manifest);
    logManifest({ manifest: r.manifest, payloadExcerpt: payload });
  }

  async function doAppendEdit() {
    setErr('');
    if (!manifest) return;
    const r = await appendEdit({ manifest, payload, note: editNote });
    if (!r.ok) { setErr(r.reason || 'edit failed'); return; }
    setManifest(r.manifest);
    setEditNote('');
    logManifest({ manifest: r.manifest, payloadExcerpt: payload });
  }

  function copyManifest() {
    if (!manifest) return;
    try { navigator.clipboard.writeText(manifestToShareString(manifest)); } catch { /* noop */ }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <textarea
        className="share-input"
        rows={5}
        placeholder="Paste the post / caption / article body to sign…"
        value={payload}
        onChange={(e) => setPayload(e.target.value)}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <input
          className="share-input"
          type="text"
          placeholder="Device (e.g. iPhone 15 Pro)"
          value={device}
          onChange={(e) => setDevice(e.target.value)}
          maxLength={80}
        />
        <input
          className="share-input"
          type="text"
          placeholder="Location (e.g. Brooklyn rooftop)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={80}
        />
      </div>
      <input
        className="share-input"
        type="text"
        placeholder="Note (caption draft, intent, source)…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{ marginTop: 8 }}
        maxLength={200}
      />

      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={doSign} disabled={!ready}>Sign</button>
        {manifest && <button className="ghost small" onClick={copyManifest}>Copy manifest</button>}
      </div>

      {err && <p className="muted small-note" style={{ color: '#dd6974' }}>{err}</p>}

      {manifest && (
        <ManifestView
          manifest={manifest}
          onAppend={doAppendEdit}
          editNote={editNote}
          setEditNote={setEditNote}
          payload={payload}
        />
      )}
    </div>
  );
}

function ManifestView({ manifest, onAppend, editNote, setEditNote, payload }) {
  const last = manifest.chain[manifest.chain.length - 1];
  return (
    <div
      style={{
        marginTop: 12,
        padding: '10px 14px',
        borderRadius: 8,
        background: 'rgba(122,143,231,0.08)',
        borderLeft: '3px solid #7a8fe7',
      }}
    >
      <strong>Manifest · {manifest.chain.length} step{manifest.chain.length === 1 ? '' : 's'}</strong>
      <p className="muted small-note" style={{ margin: '4px 0 0', fontFamily: 'monospace' }}>
        fp {manifest.fingerprint.slice(0, 12)}… · last sig {last.sig.slice(0, 12)}…
      </p>
      <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
        {manifest.chain.map((s, i) => (
          <li key={s.hash} style={{ marginBottom: 4, fontFamily: 'monospace', fontSize: 12 }}>
            <span style={{ color: '#7a8fe7' }}>{s.kind}</span>
            {s.note ? ` · ${s.note}` : ''} · h={s.hash.slice(0, 10)}…
            {s.prevHash ? ` ← ${s.prevHash.slice(0, 8)}…` : ' (origin)'}
          </li>
        ))}
      </ol>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 10 }}>
        <input
          className="share-input"
          type="text"
          placeholder="Edit note (e.g. fixed typo, replaced photo)…"
          value={editNote}
          onChange={(e) => setEditNote(e.target.value)}
          maxLength={200}
        />
        <button className="btn-sm" onClick={onAppend} disabled={!payload}>Append edit</button>
      </div>
    </div>
  );
}

function VerifyTab({ supported }) {
  const [manifestStr, setManifestStr] = useState('');
  const [payload, setPayload] = useState('');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  async function doVerify() {
    setErr('');
    setResult(null);
    if (!supported) { setErr('Web Crypto unavailable'); return; }
    const m = tryParseManifest(manifestStr);
    if (!m) { setErr('Manifest is not valid JSON or has unknown version'); return; }
    const r = await verifyManifest({ manifest: m, payload });
    setResult(r);
  }

  const tone = !result ? '#7a8fe7' : result.ok ? '#5ee69a' : '#dd6974';

  return (
    <div style={{ marginTop: 12 }}>
      <textarea
        className="share-input"
        rows={4}
        placeholder='Paste manifest JSON ({"v":"brainsnn-prov/1",…})…'
        value={manifestStr}
        onChange={(e) => setManifestStr(e.target.value)}
      />
      <textarea
        className="share-input"
        rows={4}
        placeholder="Paste the content the manifest was issued for…"
        value={payload}
        onChange={(e) => setPayload(e.target.value)}
        style={{ marginTop: 8 }}
      />
      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={doVerify}>Verify</button>
      </div>

      {err && <p className="muted small-note" style={{ color: '#dd6974' }}>{err}</p>}

      {result && (
        <div
          style={{
            marginTop: 10,
            padding: '10px 14px',
            borderRadius: 8,
            background: `${tone}14`,
            borderLeft: `3px solid ${tone}`,
          }}
        >
          <strong style={{ color: tone }}>
            {result.ok ? 'Verified' : `Failed · ${result.reason}`}
          </strong>
          {result.fingerprint && (
            <p className="muted small-note" style={{ margin: '4px 0 0', fontFamily: 'monospace' }}>
              signer fp {result.fingerprint.slice(0, 16)}…
              {result.handle ? ` · ${result.handle}` : ''}
            </p>
          )}
          {result.steps && (
            <ol style={{ margin: '8px 0 0', paddingLeft: 20, fontFamily: 'monospace', fontSize: 12 }}>
              {result.steps.map((s) => (
                <li key={s.hash}>
                  <span style={{ color: '#7a8fe7' }}>{s.kind}</span>
                  {s.note ? ` · ${s.note}` : ''} · {s.capturedAt.slice(0, 19)}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function HumanityTab() {
  const [text, setText] = useState('');
  const result = useMemo(() => humanityScore(text), [text]);
  const tone = (
    result.score >= 65 ? '#5ee69a'
      : result.score >= 45 ? '#fdab43'
        : '#dd6974'
  );

  return (
    <div style={{ marginTop: 12 }}>
      <textarea
        className="share-input"
        rows={6}
        placeholder="Paste a draft caption / post / paragraph…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div
        style={{
          marginTop: 10,
          padding: '10px 14px',
          borderRadius: 8,
          background: `${tone}14`,
          borderLeft: `3px solid ${tone}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <strong style={{ color: tone }}>{result.score}/100 · {result.tier}</strong>
          <span className="muted small-note">heuristic — not proof</span>
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 6 }}>
          {Object.entries(result.axes || {}).map(([k, v]) => (
            <div key={k} style={{ fontSize: 12 }}>
              <div className="muted small-note">{k}</div>
              <div style={{ height: 4, background: 'rgba(0,0,0,0.2)', borderRadius: 4, marginTop: 2 }}>
                <div
                  style={{
                    width: `${v}%`,
                    height: '100%',
                    background: k === 'boilerplate' ? '#dd6974' : '#5ee69a',
                    borderRadius: 4,
                  }}
                />
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, marginTop: 2 }}>{v}%</div>
            </div>
          ))}
        </div>
        {result.evidence && result.evidence.length > 0 && (
          <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 12 }}>
            {result.evidence.map((e, i) => (
              <li key={i}>
                <span className="muted">{e.axis} ×{e.hits}</span> — {e.note}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="muted small-note" style={{ marginTop: 8 }}>
        Reads polished? Add a hedge, a detail only you'd notice, a typo
        you'd actually leave in. The "humanity" axis is what stands out
        in a feed of perfect copy.
      </p>
    </div>
  );
}

function LogTab() {
  const [log, setLog] = useState(() => recentManifestLog());

  function refresh() { setLog(recentManifestLog()); }
  function clearAll() {
    if (!window.confirm('Clear the local manifest log?')) return;
    clearManifestLog();
    refresh();
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="control-actions" style={{ marginBottom: 8 }}>
        <button className="ghost small" onClick={refresh}>Refresh</button>
        <button className="ghost small" onClick={clearAll} style={{ color: '#dd6974' }}>Clear</button>
      </div>
      {log.length === 0 ? (
        <p className="muted small-note">No manifests issued yet.</p>
      ) : log.map((entry) => (
        <div
          key={`${entry.payloadHash}-${entry.ts}`}
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.03)',
            marginTop: 4,
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>
              <strong>{entry.handle || 'unsigned-handle'}</strong> · {entry.payloadKind} · {entry.stepCount} step{entry.stepCount === 1 ? '' : 's'}
            </span>
            <span className="muted small-note">{new Date(entry.ts).toLocaleString()}</span>
          </div>
          <div className="muted small-note">
            fp {entry.fingerprint.slice(0, 12)}… · payload {entry.payloadHash.slice(0, 12)}…
          </div>
          {entry.excerpt && <div style={{ marginTop: 2 }}>“{entry.excerpt}”</div>}
        </div>
      ))}
    </div>
  );
}
