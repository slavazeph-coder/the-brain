# BrainSNN

![MIT License](https://img.shields.io/badge/license-MIT-green)
![React Three Fiber](https://img.shields.io/badge/React%20Three%20Fiber-R3F-black)
![Three.js](https://img.shields.io/badge/Three.js-3D-informational)

**BrainSNN reads the feed back.**

This package is the public BrainSNN.com marketing site. It explains the product in plain English: social feeds learn what keeps people watching; BrainSNN shows what posts, ads, and narratives are trying to make people feel, believe, and do.

The page points visitors to the working scanner at `https://brainsnn.com/app`, while the embedded React Three Fiber brain keeps the deeper personal-AI infrastructure visible.

No backprop.  
No retraining.  
No account required for the core scanner.

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

- Public launch page for BrainSNN.com
- Feed mirror section inspired by short-form social product positioning
- Clear CTA into the scanner at `https://brainsnn.com/app`
- Live 3D R3F brain graph with STDP-like weight updates
- Browser-first build with no backend required

## Deploy

`main` deploys to BrainSNN.com through the root Railway app workflow. Local fallback:

```bash
cd ui/brainsnn-site
npm ci
npm run build
```

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
