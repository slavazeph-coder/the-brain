// Shared-state (URL hash) codec. Extracted from SharePanel so App.jsx can
// rehydrate from the hash WITHOUT importing the SharePanel component module —
// keeping SharePanel free to travel with the lazy "io" section chunk.

export function encodeState(state) {
  try {
    const compact = {
      r: state.regions,
      w: state.weights,
      s: state.scenario,
      t: state.tick,
      sel: state.selected,
    };
    return btoa(JSON.stringify(compact));
  } catch {
    return "";
  }
}

export function decodeStateFromHash() {
  try {
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith("state=")) return null;
    const json = atob(hash.slice(6));
    const { r, w, s, t, sel } = JSON.parse(json);
    return { regions: r, weights: w, scenario: s, tick: t, selected: sel };
  } catch {
    return null;
  }
}
