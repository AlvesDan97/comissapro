# Dockerfile na raiz do repo para Railway/Docker
# Build context = raiz do monorepo Comiss

FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY Backend/package.json Backend/package-lock.json* ./Backend/
WORKDIR /app/Backend
RUN npm install --omit=dev

WORKDIR /app
COPY Backend ./Backend
COPY Frontend ./Frontend

WORKDIR /app/Backend
ENV NODE_ENV=production
ENV PORT=3847
EXPOSE 3847

CMD ["npm", "start"]
