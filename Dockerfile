# BrainSNN root Dockerfile for Railway deployments that build from repo root.
#
# Mirrors brainsnn-r3f-app/Dockerfile so the app builds the same whether Railway
# is rooted at the repo root or at brainsnn-r3f-app/. The deployable app is the
# TypeScript/Vite SPA served by the esbuild-bundled Express server.

FROM node:20-slim

WORKDIR /app

# Install app dependencies first for better layer caching.
COPY brainsnn-r3f-app/package.json brainsnn-r3f-app/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy app sources and build the Vite client bundle (dist/) plus the
# esbuild-bundled Express server (dist/server.cjs).
COPY brainsnn-r3f-app/ ./
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.cjs"]
