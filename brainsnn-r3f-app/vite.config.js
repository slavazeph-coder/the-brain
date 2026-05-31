/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  // Vitest config. Lives here (not vitest.config) so it shares the app's
  // resolve/transform pipeline. The `test` key is inert during `vite build`.
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    css: false,
    // jsdom can't run WebGL; never pull the real three.js scene into a test.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
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
      onwarn(warning, warn) {
        // Suppress the benign "dynamic import will not move module into another
        // chunk" notice for geminiEngine/lobsterTrap. These are dynamically
        // imported from the entry-chunk modules (cognitiveFirewall.js,
        // brainLLM.js, mcpBridge.js, counterDraft.js) to keep them OUT of the
        // entry bundle; a few lazy-loaded panels still import them statically at
        // render time. The mixed graph is expected — the modules already live
        // only in lazy chunks, never the entry. Match on message text, not code
        // (Vite emits this via a plugin warning, not the Rollup constant).
        const msg = warning.message || "";
        if (
          msg.includes(
            "dynamic import will not move module into another chunk",
          ) &&
          (msg.includes("geminiEngine") || msg.includes("lobsterTrap"))
        ) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks: {
          three: ["three", "@react-three/fiber", "@react-three/drei"],
          postprocessing: ["@react-three/postprocessing", "postprocessing"],
        },
      },
    },
  },
});
