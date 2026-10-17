# API do Sentinela para o servidor de desenvolvimento (ffmpeg embutido).
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --workspace api --no-audit --no-fund

COPY api api
WORKDIR /app/api
ENV NODE_ENV=production

# Aplica as migrations, garante o usuário inicial (seed idempotente) e sobe a API.
CMD ["sh", "-c", "npx tsx src/db/migrate.ts && npx tsx src/db/seed.ts && exec npx tsx src/server.ts"]
