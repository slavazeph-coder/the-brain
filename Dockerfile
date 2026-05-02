# BrainSNN root Dockerfile for Railway deployments that build from repo root.
#
# The deployable app lives in brainsnn-r3f-app/. This wrapper keeps Railway
# deterministic even if the dashboard Root Directory is left at the repository
# root instead of the app subdirectory.

FROM node:20-slim

WORKDIR /app

# Install app dependencies first for better layer caching.
COPY brainsnn-r3f-app/package.json brainsnn-r3f-app/package-lock.json brainsnn-r3f-app/.npmrc ./
RUN npm ci --no-audit --no-fund

# Copy the deployable app and build the Vite bundle served by server.js.
COPY brainsnn-r3f-app/ ./
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
