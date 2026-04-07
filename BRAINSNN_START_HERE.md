# BrainSNN Start Here

This branch now contains **two BrainSNN app surfaces** inside the same repo.

## 1) `ui/brainsnn-site`
Use this when you want the **public launch surface**.

What it is:
- sticky-nav landing page
- premium hero section
- live 3D brain demo
- viral toolkit for X / HN / Reddit
- README preview and launch checklist
- GitHub Pages workflow support

Best for:
- launch day
- GitHub star conversion
- sharing on social
- open-source discovery

## 2) `ui/brainsnn-viewer`
Use this when you want the **stronger product-style interactive app**.

What it is:
- 3D viewer with right-side inspector
- scenario presets
- selected-region details
- pathway inspection and sparkline trend
- cleaner product dashboard feel

Best for:
- deeper demo sessions
- product positioning
- technical walkthroughs
- future productization

## Recommended framing

- `ui/brainsnn-site` = the public launch page
- `ui/brainsnn-viewer` = the stronger in-product experience

## Recommended next move after merge

1. Merge PR #1
2. Turn on GitHub Pages for `ui/brainsnn-site`
3. Replace placeholder media in the landing page
4. Decide whether to deploy `ui/brainsnn-viewer` separately on Vercel
5. Update the landing page later so its CTA points into the deployed viewer

## Why both matter

The launch page gets attention.
The viewer proves there is a real product layer underneath it.
