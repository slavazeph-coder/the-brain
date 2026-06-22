# BrainSNN root Dockerfile for Railway deployments that build from repo root.
#
# The deployable app lives in brainsnnworkspace/ — a TypeScript/Vite SPA served
# by an Express server (bundled to dist/server.cjs via esbuild). This wrapper
# keeps Railway deterministic even if the dashboard Root Directory is left at the
# repository root instead of the app subdirectory.

FROM node:20-slim

WORKDIR /app

# Install app dependencies first for better layer caching.
COPY brainsnnworkspace/package.json brainsnnworkspace/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy the app sources and build the Vite client bundle (dist/) plus the
# esbuild-bundled Express server (dist/server.cjs).
COPY brainsnnworkspace/ ./
RUN npm run build

# The server reads GEMINI_API_KEY at runtime (set it as a Railway service
# variable). Without a key it serves the deterministic local SNN simulation.
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.cjs"]
