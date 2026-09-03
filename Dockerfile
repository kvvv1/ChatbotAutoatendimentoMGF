# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache ca-certificates

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# =============================================================================
# Stage 2: Runtime
# =============================================================================
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache ca-certificates

# Instala apenas dependências de produção
COPY package*.json ./
RUN npm ci --omit=dev

# Copia build e assets estáticos
COPY --from=builder /app/dist ./dist
COPY painel-atendimento/ ./painel-atendimento/
COPY assets/video/ ./assets/video/

# assets/audio NÃO vai na imagem — é montado como volume no docker-compose de cada
# cliente (ex: ./volumes/chatbot/audios:/app/assets/audio:ro), com welcome.wav e menu.wav

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
