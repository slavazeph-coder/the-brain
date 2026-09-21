# BrainSNN: existing TypeScript/Vite app plus additive sponsor studios.
FROM node:22-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Both licensed model assets are verified and self-hosted during the build.
RUN npm install --prefix sponsorship --omit=dev --no-audit --no-fund \
  && node sponsorship/build.cjs \
  && node sponsorship/gt3/tidy-build.cjs \
  && node sponsorship/gt3/build.cjs \
  && SPONSOR_SKIP_PRELOAD=true node --test sponsorship/tests/*.test.cjs \
  && npm run lint \
  && npm test \
  && npm run build \
  && cd mcp-server \
  && npm ci --no-audit --no-fund \
  && npm run smoke \
  && rm -rf node_modules
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT||8080) + '/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--require", "./sponsorship/gt3/server.cjs", "--require", "./brand-brain-preload.cjs", "--require", "./mission-market-preload.cjs", "--require", "./sponsorship/server.cjs", "dist/server.cjs"]
