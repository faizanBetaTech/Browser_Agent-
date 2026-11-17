FROM node:22-bookworm-slim

WORKDIR /app

# Base networking, TLS certs, and headless font support
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

# Copy manifest and install Node dependencies + Patchright Chromium binary
COPY package.json ./
RUN npm install --no-audit --no-fund \
  && npx patchright install-deps chromium \
  && rm -rf /var/lib/apt/lists/*

# Copy application source and build the React/Vite frontend
COPY . .
RUN npm run build

# Enable production serving of built ./dist assets via server.ts
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["npm", "run", "start"]
