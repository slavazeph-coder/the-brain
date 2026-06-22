# BrainSNN — TypeScript/Vite SPA served by a bundled Express server.
#
# Railway's service is rooted at this directory, so this Dockerfile is what
# production builds. The repo-root Dockerfile mirrors it for repo-root builds.
#
#   docker build -t brainsnn .
#   docker run -p 8080:8080 --rm -e PORT=8080 brainsnn

FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Source + build (Vite client bundle in dist/ + esbuild server at dist/server.cjs).
COPY . .
RUN npm run build

# GEMINI_API_KEY is read at runtime (set it as a Railway service variable).
# Without a key the server runs the deterministic local SNN simulation.
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT||8080) + '/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
