# Deploy BrainSNN

## GitHub Pages

A workflow is included at:

- `.github/workflows/brainsnn-site-pages.yml`

### First-time setup

1. Open **Settings → Pages** in the repository.
2. Set **Source** to **GitHub Actions**.
3. Merge the `feat/brainsnn-launch-site` branch into `main`.
4. The workflow will build `ui/brainsnn-site` and publish `dist/` automatically.

### Notes

- The app already uses `base: "./"` in Vite, which keeps asset URLs safe for GitHub Pages.
- After the first successful deploy, update `src/constants/site.js` so `SITE.demoUrl` matches the actual live Pages URL.
- Replace the placeholder assets in `public/` before launch day.

## Vercel

If you prefer Vercel:

- Root Directory: `ui/brainsnn-site`
- Build Command: `npm run build`
- Output Directory: `dist`

## Recommended launch order

1. Merge the PR
2. Turn on Pages
3. Wait for the first deploy
4. Update `SITE.demoUrl`
5. Replace placeholder media with a real GIF / clip
6. Launch with the toolkit copy in the site
