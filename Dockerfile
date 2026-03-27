# Stage 1: Base
FROM node:24-slim AS base
# Ativa o Corepack para gerenciar o pnpm nativamente
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
# Copiamos o lockfile específico do pnpm
COPY pnpm-lock.yaml package.json ./

# Stage 2: Development
FROM base AS development
# Usamos cache do Docker para o store do pnpm para builds locais rápidos
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY tsconfig*.json ./
COPY src ./src
COPY scripts ./scripts
EXPOSE 3001
CMD ["pnpm", "run", "dev"]

# Stage 3: Builder (Production Build)
FROM base AS builder
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY tsconfig*.json ./
COPY src ./src
COPY scripts ./scripts
RUN pnpm run build

# Stage 4: Production Runtime
FROM node:24-slim AS production
RUN apt-get update && apt-get install -y iputils-ping && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
# Instalamos apenas dependências de produção
RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts ./scripts
RUN chown -R node:node /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node /app/scripts/healthcheck.js

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/main.js"]