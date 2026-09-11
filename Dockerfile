# ---------- Stage 1: build ----------
FROM node:22-alpine AS builder

RUN apk add --no-cache openssl
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Remove as devDependencies para copiar um node_modules enxuto ao runtime.
# O CLI do Prisma sobrevive a este prune por estar declarado em `dependencies`:
# ele é necessário em runtime para o `prisma migrate deploy` do CMD abaixo
# (e para o initContainer de migrations no Kubernetes).
RUN npm prune --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:22-alpine AS runtime

RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

# Executa como usuário sem privilégios (a imagem node já traz o usuário "node").
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --chown=node:node package*.json ./

USER node
EXPOSE 3000

# Aplica as migrations pendentes antes de subir a API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
