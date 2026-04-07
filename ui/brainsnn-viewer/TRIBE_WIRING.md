# TRIBE V2 Wiring Guide

The TRIBE V2 files are already added:

- `src/utils/tribe.js`
- `src/components/TRIBEPanel.jsx`

Because the current GitHub connector is weak at rewriting existing files in place, use the patch below to wire TRIBE into the viewer shell.

## 1) Update `src/App.jsx`

Add imports:

```jsx
import TRIBEPanel from './components/TRIBEPanel';
```

Then render the panel in the main column, ideally after the lower metrics / explainer grid:

```jsx
<TRIBEPanel
  state={state}
  onApplyState={setState}
/>
```

## 2) Add CSS to `src/styles/global.css`

```css
.tribe-panel { display: grid; gap: 16px; }
.tribe-input {
  width: 100%;
  min-height: 120px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,.08);
  background: var(--surface-2);
  color: var(--text);
  padding: 14px;
  resize: vertical;
  font: inherit;
}
.tribe-result { display: grid; gap: 16px; margin-top: 4px; }
.tribe-overall {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--risk) 14%, var(--surface-2));
  border: 1px solid color-mix(in srgb, var(--risk) 35%, transparent);
}
.tribe-overall strong { font-size: 1.5rem; color: var(--risk); }
.tribe-scores { display: grid; gap: 14px; }
.tribe-score-row {
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface-2);
  border: 1px solid rgba(255,255,255,.05);
}
.tribe-score-head { display: flex; justify-content: space-between; margin-bottom: 4px; }
.tribe-score-row .muted { font-size: .85rem; margin-bottom: 10px; }
.tribe-action {
  padding: 14px;
  border-radius: 14px;
  background: var(--surface-2);
  border: 1px solid rgba(255,255,255,.05);
}
.tribe-evidence {
  padding: 14px;
  border-radius: 14px;
  background: var(--surface-2);
  border: 1px solid rgba(255,255,255,.05);
}
.tribe-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.tribe-chip {
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.08);
  font-size: .8rem;
  color: var(--muted);
}
.tribe-confidence { text-align: right; font-size: .85rem; color: var(--muted); }
```

## 3) What this enables

- Scan pasted content for manipulation signatures
- Show a glanceable risk readout
- Apply the score back into the BrainSNN network state
- Spike AMY / THL under emotional activation
- Damp PFC / CTX under cognitive suppression
- Raise BG gating under manipulation pressure

## 4) Product interpretation

This turns BrainSNN from a pure 3D neural viewer into:

- **See your brain** — BrainSNN viewer
- **Understand your brain** — TRIBE V2 scoring
- **Protect your brain** — extension / agent path later
