# 🧠 BrainSNN

![MIT License](https://img.shields.io/badge/license-MIT-green)
![React Three Fiber](https://img.shields.io/badge/React%20Three%20Fiber-R3F-black)
![Three.js](https://img.shields.io/badge/Three.js-3D-informational)

**Brain-inspired AI that never stops learning.**

BrainSNN is an open-source 3D neuromorphic brain network visualizer built with React Three Fiber. It models **7 brain regions**, **10 plastic pathways**, and a simplified **STDP continuous learning rule** in real time.

No backprop.  
No retraining.  
No server required for the main demo.  

## Quick start

```bash
git clone https://github.com/slavazeph-coder/the-brain
cd the-brain
cd ui/brainsnn-site
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## What is inside

- Cinematic launch page with strong GitHub CTA
- Live 3D R3F brain graph with STDP-like weight updates
- Viral launch toolkit for X, HN, and Reddit
- README preview block and launch checklist
- Browser-first build with no backend required

## Add a region

Update `src/constants/site.js`:

```js
BRAIN_REGIONS.push({
  code: "OFC",
  name: "Orbitofrontal Cortex",
  position: [2.7, 2.25, 1.0],
  color: "#f59e0b",
  baseActivity: 0.18,
  description: "Reward and valuation signals."
});
```

Then add a pathway in `PATHWAYS`.

## Notes

- Replace the placeholder GIF/image assets in `public/`
- Update `SITE.demoUrl` after deployment
- Seed good first issues before public launch

## License

MIT
