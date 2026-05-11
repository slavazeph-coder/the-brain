# BrainSNN — unified Vite SPA + Express server for Railway.
#
#   docker build -t brainsnn .
#   docker run -p 8080:8080 --rm -e PORT=8080 brainsnn
#
# Single-stage keeps the image simple; @resvg/resvg-js ships a prebuilt
# native binary so no native toolchain is needed at runtime.

FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching. Use npm ci when a lockfile exists.
COPY package.json package-lock.json* .npmrc* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# Source + build
COPY . .

# Railway Docker builds only expose service variables to build steps when the
# Dockerfile declares them as ARGs. Vite reads VITE_* at build time.
ARG VITE_GEMINI_API_KEY
ARG VITE_GEMINI_MODEL
ARG VITE_GEMINI_API_BASE
ARG VITE_GEMMA_API_ENDPOINT
ARG VITE_GEMMA_API_KEY
ARG VITE_GEMMA_MODEL
ARG VITE_TRIBE_API
ARG VITE_SYNC_WS_URL
ARG VITE_LOBSTER_TRAP_URL
ARG VITE_LOBSTER_TRAP_KEY
ENV VITE_GEMINI_API_KEY=$VITE_GEMINI_API_KEY
ENV VITE_GEMINI_MODEL=$VITE_GEMINI_MODEL
ENV VITE_GEMINI_API_BASE=$VITE_GEMINI_API_BASE
ENV VITE_GEMMA_API_ENDPOINT=$VITE_GEMMA_API_ENDPOINT
ENV VITE_GEMMA_API_KEY=$VITE_GEMMA_API_KEY
ENV VITE_GEMMA_MODEL=$VITE_GEMMA_MODEL
ENV VITE_TRIBE_API=$VITE_TRIBE_API
ENV VITE_SYNC_WS_URL=$VITE_SYNC_WS_URL
ENV VITE_LOBSTER_TRAP_URL=$VITE_LOBSTER_TRAP_URL
ENV VITE_LOBSTER_TRAP_KEY=$VITE_LOBSTER_TRAP_KEY

RUN npm run build

# Security + port
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Healthcheck hits the Express /healthz
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT||8080) + '/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
