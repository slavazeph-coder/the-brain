// Purpose-led entry points use the same capture and World Builder tools.
// Never infer age, record a birth date, or treat a goal as proof of accuracy.
export const WORLD_GOALS = Object.freeze([
  {
    id: 'play',
    title: 'Explore a photo',
    summary: 'Turn one picture into a visual 3D idea.',
    availability: 'On-device preview',
    guidance: 'Choose one clear photo. A grown-up should help children photograph or share private spaces.',
    captureTip: 'Start with a well-lit photo. The optional depth preview is illustrative, with no measured scale or hidden geometry.',
    useCase: 'general',
  },
  {
    id: 'room',
    title: 'Plan my room',
    summary: 'Explore a space before rearranging it.',
    availability: 'Capture and review',
    guidance: 'Record a slow, overlapping walkthrough. Add a real tape measurement before trusting any dimensions.',
    captureTip: 'Walk slowly around the room, show corners and doorways, and return to a place already filmed. Worker reconstruction may be incomplete.',
    useCase: 'general',
  },
  {
    id: 'bim',
    title: 'Make a building model',
    summary: 'Prepare a model for BIM, CAD or renovation work.',
    availability: 'Worker required',
    guidance: 'Capture overlapping video, measure a known span and check separate distances before professional export.',
    captureTip: 'Capture both sides of important objects, walls and openings. IFC and Rhino exports need a connected worker, entered scale and human review.',
    useCase: 'architecture',
  },
  {
    id: 'robot',
    title: 'Test a robot route',
    summary: 'Explore paths and obstacles in a reviewed map.',
    availability: 'Planning only',
    guidance: 'Scan the full route, review unseen areas as blocked and verify clearances before testing a robot.',
    captureTip: 'Include doorways, ramps, turns and obstacles. The resulting routes are planning previews, not safety or physical robot validation.',
    useCase: 'robotics',
  },
]);

export function goalFromSearch(search = '') {
  const params = new URLSearchParams(search);
  const goal = params.get('goal');
  if (WORLD_GOALS.some(item => item.id === goal)) return goal;
  const purpose = params.get('use');
  if (purpose === 'robotics') return 'robot';
  if (['trades', 'architecture', 'industrial', 'developers'].includes(purpose)) return 'bim';
  return 'room';
}

export function goalById(id) {
  return WORLD_GOALS.find(item => item.id === id) || WORLD_GOALS[1];
}
