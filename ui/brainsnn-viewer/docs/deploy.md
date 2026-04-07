# Deploy BrainSNN Viewer

`ui/brainsnn-viewer` is the stronger product-style BrainSNN app.

Use this when you want to deploy the richer interactive demo separately from the public launch page.

## Recommended deployment target

### Vercel

This folder now includes `vercel.json`.

Recommended Vercel settings:
- Root Directory: `ui/brainsnn-viewer`
- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

### Local run

```bash
cd ui/brainsnn-viewer
npm install
npm run dev
```

### Local production preview

```bash
npm run build
npm run preview
```

## Recommended product / launch split

- `ui/brainsnn-site` → public launch surface
- `ui/brainsnn-viewer` → deeper interactive demo

## Recommended next move after deploy

Once the viewer has a stable URL:
1. Update the landing page copy to point to the deployed viewer
2. Add viewer screenshots / GIFs to the launch page
3. Use the viewer URL in technical posts and product walkthroughs
4. Use the landing page URL in broad discovery channels

## Suggested URL structure

- Landing page: `brainsnn.yourdomain.com`
- Viewer: `viewer.brainsnn.yourdomain.com`

or

- Landing page: `yourdomain.com/brainsnn`
- Viewer: `yourdomain.com/brainsnn/viewer`
