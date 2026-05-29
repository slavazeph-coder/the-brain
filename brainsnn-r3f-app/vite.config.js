import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
    // Keep the 3D vendor chunks out of the entry's modulepreload — they are
    // pulled in on demand when the lazy <BrainScene> mounts, so the hero and
    // controls paint without waiting on (or pre-fetching) ~1MB of three.js.
    modulePreload: {
      resolveDependencies: (_file, deps) =>
        deps.filter(
          (d) => !/(three|postprocessing|BrainScene|SplitBrainView)-/.test(d),
        ),
    },
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "@react-three/fiber", "@react-three/drei"],
          postprocessing: ["@react-three/postprocessing", "postprocessing"],
        },
      },
    },
  },
});
