# ─── Stage 1: Instalar dependencias ──────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Stage 2: Imagen de producción ──────────────────────────────────────────
FROM node:20-alpine AS production

# Seguridad: ejecutar como usuario no-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copiar solo dependencias de producción desde stage anterior
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

# Cambiar a usuario no-root
USER appuser

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3002/notifications/health || exit 1

CMD ["node", "src/server.js"]
