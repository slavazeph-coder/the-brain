/** Literal, labelled pictures for the World Builder playground. Every icon sits beside a visible word; none carries meaning alone. */
const svg = (viewBox, body, cls = '') => `<svg viewBox="${viewBox}"${cls ? ` class="${cls}"` : ''} aria-hidden="true" focusable="false">${body}</svg>`;

/** One drawing per robot shape in core.mjs ROBOTS. The planner only uses each body's size and speed. */
export const ROBOT_ART = {
  cleaner: svg('0 0 96 72', `<ellipse class="ri-shadow" cx="48" cy="65" rx="31" ry="4"/>
    <path class="ri-line" d="M48 13V7"/><circle class="ri-eye" cx="48" cy="5.5" r="2.6"/>
    <rect class="ri-body" x="27" y="13" width="42" height="40" rx="10"/>
    <rect class="ri-screen" x="34" y="20" width="28" height="16" rx="6"/>
    <circle class="ri-eye" cx="42.5" cy="28" r="2.4"/><circle class="ri-eye" cx="53.5" cy="28" r="2.4"/>
    <path class="ri-thin" d="M43 42q5 3 10 0"/>
    <rect class="ri-accent" x="22" y="53" width="52" height="7" rx="3.5"/>
    <path class="ri-thin" d="M29 61v3M36 61v3M43 61v3M50 61v3M57 61v3M64 61v3"/>
    <circle class="ri-bubble" cx="80" cy="47" r="3.2"/><circle class="ri-bubble" cx="86" cy="39" r="2"/><circle class="ri-bubble" cx="14" cy="45" r="2.6"/>`, 'robot-art'),
  vacuum: svg('0 0 96 72', `<ellipse class="ri-shadow" cx="48" cy="60" rx="33" ry="5"/>
    <path class="ri-body" d="M17 38v8c0 7.7 13.9 13 31 13s31-5.3 31-13v-8"/>
    <ellipse class="ri-body" cx="48" cy="38" rx="31" ry="13"/>
    <path class="ri-accent-line" d="M21 43.5c5.5 5.8 15.5 8.5 27 8.5s21.5-2.7 27-8.5"/>
    <ellipse class="ri-screen" cx="48" cy="34" rx="9" ry="4"/><circle class="ri-eye" cx="48" cy="33.6" r="2"/>
    <path class="ri-thin" d="M80 23c4.5-1.2 7 2 4.8 4.6M12 26c-3.6 1.2-3.6 4.6 0 5.8"/>`, 'robot-art'),
  amr: svg('0 0 96 72', `<ellipse class="ri-shadow" cx="48" cy="64" rx="35" ry="4"/>
    <rect class="ri-crate" x="29" y="15" width="38" height="25" rx="3"/><path class="ri-crate-line" d="M29 23.5h38M48 15v25"/>
    <rect class="ri-body" x="15" y="40" width="66" height="13" rx="5"/>
    <rect class="ri-accent" x="71" y="32" width="9" height="8" rx="2.5"/>
    <circle class="ri-eye" cx="22" cy="46.5" r="2.2"/>
    <circle class="ri-wheel" cx="28" cy="56" r="5.5"/><circle class="ri-wheel" cx="68" cy="56" r="5.5"/>`, 'robot-art'),
  humanoid: svg('0 0 96 72', `<ellipse class="ri-shadow" cx="48" cy="67" rx="19" ry="3.5"/>
    <path class="ri-limb" d="M36.5 27 28 41M59.5 27 68 41"/>
    <rect class="ri-body" x="37" y="3" width="22" height="17" rx="7.5"/>
    <rect class="ri-screen" x="40.5" y="8" width="15" height="7" rx="3.5"/>
    <circle class="ri-eye" cx="44.5" cy="11.5" r="1.6"/><circle class="ri-eye" cx="51.5" cy="11.5" r="1.6"/>
    <rect class="ri-body" x="35" y="22" width="26" height="22" rx="8"/>
    <circle class="ri-accent" cx="48" cy="31.5" r="3.4"/>
    <path class="ri-limb" d="M42.5 44v18M53.5 44v18"/><path class="ri-line" d="M37.5 63.5h8M50.5 63.5h8"/>`, 'robot-art'),
  forklift: svg('0 0 96 72', `<ellipse class="ri-shadow" cx="50" cy="65" rx="38" ry="4"/>
    <path class="ri-line" d="M67 9v48M73 9v48"/><path class="ri-thin" d="M67 18h6M67 31h6M67 44h6"/>
    <rect class="ri-crate" x="75" y="35" width="15" height="14" rx="2"/>
    <path class="ri-accent" d="M70 50h21v4.5H70z"/>
    <path class="ri-body" d="M36 36l8-18h16v18z"/><path class="ri-screen" d="M45.5 22H56v11H41.5z"/>
    <rect class="ri-body" x="11" y="36" width="54" height="20" rx="5"/>
    <circle class="ri-wheel" cx="24" cy="57" r="7.5"/><circle class="ri-wheel" cx="53" cy="57" r="7.5"/>
    <circle class="ri-eye" cx="16" cy="43" r="2.2"/>`, 'robot-art'),
};

/** World choices: the example room, the street block, an empty map, your own capture and a map saved in this browser. */
export const WORLD_ICONS = {
  sample: svg('0 0 48 48', `<path class="wi-floor" d="M4 25 24 15l20 10-20 10z"/>
    <path class="wi-box" d="M12 18.5 18 15.5l6 3v7l-6 3-6-3z"/><path class="wi-edge" d="M12 18.5l6 3 6-3M18 21.5v7"/>
    <path class="wi-box2" d="M27 23l4.5-2.2L36 23v5.5l-4.5 2.2-4.5-2.2z"/><path class="wi-edge" d="M27 23l4.5 2.2L36 23M31.5 25.2v5.5"/>`, 'world-art'),
  street: svg('0 0 48 48', `<path class="wi-line" d="M4 41h40"/>
    <rect class="wi-box" x="7" y="15" width="12" height="26" rx="1.5"/><rect class="wi-box2" x="21" y="24" width="9" height="17" rx="1.5"/>
    <rect class="wi-box" x="32" y="9" width="10" height="32" rx="1.5"/>
    <path class="wi-thin" d="M10.5 20h2M14.5 20h2M10.5 25.5h2M14.5 25.5h2M10.5 31h2M14.5 31h2M35 14h4M35 19.5h4M35 25h4M35 30.5h4"/>`, 'world-art'),
  empty: svg('0 0 48 48', `<path class="wi-dashed" d="M4 30 24 20l20 10-20 10z"/><path class="wi-line" d="M24 5v12M18 11h12"/>`, 'world-art'),
  capture: svg('0 0 48 48', `<rect class="wi-box" x="5" y="14" width="38" height="25" rx="5"/><path class="wi-line" d="M16 14l3.2-5h9.6l3.2 5"/>
    <circle class="wi-lens" cx="24" cy="26.5" r="7.5"/><circle class="wi-dot" cx="36.5" cy="19.5" r="1.7"/>`, 'world-art'),
  saved: svg('0 0 48 48', `<path class="wi-box" d="M5 14a3 3 0 0 1 3-3h10l4 4h18a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"/>
    <path class="wi-line" d="M24 34V22M18.5 27.5 24 22l5.5 5.5"/>`, 'world-art'),
};

const line = body => svg('0 0 24 24', body, 'line-icon');

/** Small line icons for the tool strip, the camera buttons and editing actions. */
export const ICONS = {
  capture: line('<path d="M3.5 8.5h3.2l2-3h6.6l2 3h3.2v11h-17z"/><circle cx="12" cy="13.6" r="3.6"/>'),
  explore: line('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  drawings: line('<path d="M4 20l1.2-4.8L15.6 4.8l3.6 3.6L8.8 18.8z"/><path d="M13.4 7l3.6 3.6"/>'),
  robots: line('<rect x="5" y="8.5" width="14" height="11" rx="3"/><path d="M12 8.5V5"/><circle cx="12" cy="4" r="1.2"/><circle cx="9.4" cy="13.6" r="1.3"/><circle cx="14.6" cy="13.6" r="1.3"/>'),
  save: line('<path d="M12 4v10.5M7.8 10.3 12 14.5l4.2-4.2"/><path d="M4 15.5V20h16v-4.5"/>'),
  checks: line('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>'),
  turnLeft: line('<path d="M6.2 10.5a6.6 6.6 0 1 1 2 6"/><path d="M5.5 5v5.6h5.6"/>'),
  turnRight: line('<path d="M17.8 10.5a6.6 6.6 0 1 0-2 6"/><path d="M18.5 5v5.6h-5.6"/>'),
  zoomIn: line('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M10.5 7.8v5.4M7.8 10.5h5.4"/>'),
  zoomOut: line('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M7.8 10.5h5.4"/>'),
  home: line('<path d="M3.5 11.5 12 4.5l8.5 7"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5v-5h4v5"/>'),
  names: line('<path d="M3.5 4.5h8l9 9-7 7-9-9z"/><circle cx="8" cy="9" r="1.5"/>'),
  undo: line('<path d="M9 5.5 4.5 10 9 14.5"/><path d="M4.5 10H14a5.5 5.5 0 0 1 0 11h-3"/>'),
  redo: line('<path d="M15 5.5l4.5 4.5-4.5 4.5"/><path d="M19.5 10H10a5.5 5.5 0 0 0 0 11h3"/>'),
  play: svg('0 0 24 24', '<path d="M7.5 4.8v14.4L19 12z"/>', 'fill-icon'),
  stop: svg('0 0 24 24', '<rect x="6" y="6" width="12" height="12" rx="2"/>', 'fill-icon'),
  contrast: line('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/>'),
};
