import { defineConfig } from 'vite';

/**
 * Per-workspace bundle splits (Beast PR #10).
 *
 * Each workspace's drawer panels lazy-load inside the workspace
 * component via React.lazy; this manualChunks map ALSO groups them
 * into named chunks so the workspace's initial fetch is one HTTP
 * round-trip instead of N panels at N round-trips.
 *
 * The legacy App.jsx scroll is its own chunk (`legacy-app`), loaded
 * only when ?shell=old is set — so the default load never pulls
 * the linear-scroll markup.
 */
export default defineConfig({
  base: '/',
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // External vendor chunks first.
          if (id.includes('node_modules')) {
            if (id.match(/\/(three|@react-three)\b/)) return 'three';
            if (id.includes('@react-three/postprocessing') || id.includes('/postprocessing/')) return 'postprocessing';
            if (id.includes('react') && !id.includes('react-three')) return 'react';
            return undefined;
          }

          // Workspace chunks. Each workspace JSX + the panels it
          // lazy-imports land in the same chunk for one-round-trip load.
          const m = id.match(/\/src\/shell\/workspaces\/(\w+)Workspace\.jsx$/);
          if (m) return `ws-${m[1].toLowerCase()}`;

          // Worker source code (Vite handles them as separate entries
          // automatically, but the IDB store + token helpers shared
          // with workers benefit from a stable chunk).
          if (id.includes('/src/utils/store.js') || id.includes('/src/utils/workerPool.js')) {
            return 'shared-utils';
          }

          return undefined;
        }
      }
    }
  }
});
