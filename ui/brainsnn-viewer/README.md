# BrainSNN Viewer

A higher-fidelity React + React Three Fiber app for the BrainSNN product surface.

This app is different from `ui/brainsnn-site`:

- `ui/brainsnn-site` is the launch / viral landing page
- `ui/brainsnn-viewer` is the stronger interactive viewer with a right-side inspector, scenario presets, and product-style dashboard layout

## Features
- 7 brain regions and 10 plastic pathways
- Live STDP-style continuous learning simulation
- React Three Fiber 3D scene with glowing nodes and moving signal particles
- Right-side inspector panel with selected region details, pathway tables, and trend sparkline
- Scenario presets: Baseline, Sensory Burst, Memory Replay, Emotional Salience, Executive Override
- Vite structure for clean local development

## Run locally

```bash
cd ui/brainsnn-viewer
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```
