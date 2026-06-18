# Deploy BrainSNN site

The marketing site (`ui/brainsnn-site`) ships as part of the **Railway**
deployment that backs brainsnn.com. The repo-root `Dockerfile` builds this
site and serves its `dist/` at `/`, while the 3D app (`brainsnn-r3f-app`) is
served under `/app`. Pushing to `main` triggers the Railway build/deploy —
no separate Pages step is required.

## Build it standalone

```bash
cd ui/brainsnn-site
npm install
npm run build      # → dist/
```

## Vercel (optional alternative)

If you prefer to host this site on its own:

- Root Directory: `ui/brainsnn-site`
- Build Command: `npm run build`
- Output Directory: `dist`

## Notes

- The app uses `base: "./"` in Vite, which keeps asset URLs portable across hosts.
- Replace the placeholder assets in `public/` before launch day.
- If you host the site at its own URL, update `src/constants/site.js` so
  `SITE.demoUrl` points at the live app.
