# Contributing to BrainSNN

Thanks for taking a look at BrainSNN.

This project is built to attract a mix of:
- React Three Fiber / Three.js builders
- ML and computational neuroscience people
- frontend developers who like interactive visual systems
- open-source contributors who want a repo they can quickly understand

## Local setup

```bash
cd ui/brainsnn-site
npm install
npm run dev
```

Build before opening a PR:

```bash
npm run build
```

## Project shape

- `src/App.jsx` — launch page shell and main section layout
- `src/constants/site.js` — copy, URLs, regions, pathways, launch assets
- `src/hooks/useBrainSimulation.js` — simplified STDP-style browser simulation
- `src/styles.css` — visual system and responsive layout
- `public/` — social preview and placeholder media assets

## Good contribution areas

### Visual polish
- improve camera behavior
- improve mobile controls
- improve typography / spacing / polish
- replace placeholders with stronger assets

### Simulation
- tune activity curves
- refine STDP update behavior
- add presets for alternate topologies
- add better debug / benchmark overlays

### UX and launch
- improve README conversion to stars
- improve social preview assets
- improve screenshot / GIF capture workflow
- improve contributor onboarding

## Contribution style

Keep changes focused.

A strong PR usually does one of these well:
1. improves the live demo
2. improves launch/readability/conversion
3. improves code structure without adding noise

## Pull request checklist

- keep copy specific and builder-focused
- avoid vague AI marketing language
- test desktop and mobile widths
- run `npm run build`
- include screenshots or a short clip for UI changes

## Before opening a PR

Please check whether there is already an issue for the change.
If not, open one using the repo templates so discussion stays organized.
