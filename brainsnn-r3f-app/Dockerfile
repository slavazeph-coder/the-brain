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
RUN npm run build

# Security + port
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Healthcheck hits the Express /healthz
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT||8080) + '/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
