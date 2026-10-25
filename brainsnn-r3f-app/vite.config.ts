import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          // react must get its own chunk: otherwise rollup hoists it into
          // vendor-three (fiber imports react) and the entry ends up
          // statically importing the whole three.js bundle.
          manualChunks(id: string) {
            // Vite's preload-helper is imported by the entry; without a home it
            // gets hoisted into vendor-three and drags the 1MB chunk into the
            // initial load.
            if (id.includes('vite/preload-helper')) return 'vendor-react';
            if (/node_modules\/(three|@react-three)\//.test(id)) return 'vendor-three';
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
