# FacioMGA - Production infrastructure/docker/Dockerfile (Azure-ready)
# Key goal: ensure Chromium dependencies exist for Puppeteer PDF generation.

# Stage 1: Build frontend
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1

# Vite exposes VITE_* env vars at build-time (import.meta.env.*).
# These MUST be present during `vite build` (Azure App Settings won't affect an already-built bundle).
ARG VITE_GOOGLE_MAPS_API_KEY
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

COPY package*.json ./
COPY packages/ ./packages/
RUN npm ci
COPY tsconfig.json ./
COPY frontend/vite.config.ts frontend/vitest.config.ts ./frontend/
COPY postcss.config.js tailwind.config.js ./
COPY frontend/index.html ./frontend/
COPY frontend/public/ ./frontend/public/
COPY frontend/src/ ./frontend/src/
COPY tools/quality/ ./tools/quality/
COPY prisma/ ./prisma/
RUN npm run build:validation && npm run build:products
RUN npm run build:frontend

# Stage 2: Build backend
FROM node:20-bookworm-slim AS backend-builder
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
# tsc memory grows with the number of source files in the program; the
# operator MCP V2 additions pushed it past Node's default ~2 GB heap
# during `npm run build:api` (final `tsc -p backend/tsconfig.json` step)
# and CI started failing with "Ineffective mark-compacts near heap
# limit". 4 GB gives headroom for future module growth without changing
# tsconfig or the npm script.
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Prisma’s native engines detect / depend on OpenSSL at build time.
# Installing OpenSSL here removes ambiguity and avoids "prisma:warn" about OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends \
  openssl \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY packages/ ./packages/
RUN npm ci
COPY tsconfig.json ./
COPY prisma/ ./prisma/
COPY backend/ ./backend/
COPY tools/quality/ ./tools/quality/
COPY frontend/src/modules/policies/list/ ./frontend/src/modules/policies/list/
RUN npm run prisma:generate
RUN npm run build:api

# Stage 3: Production runtime
FROM node:20-bookworm-slim AS production
WORKDIR /app

# Install Chromium + runtime deps required by Puppeteer.
# This resolves: libglib-2.0.so.0, nss, freetype, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
  chromium \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium (avoid downloading incompatible binaries).
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install production dependencies only
COPY package*.json ./
COPY packages/ ./packages/
RUN npm ci --omit=dev && npm cache clean --force

# Prisma client is generated during the backend build stage, but `npm ci --omit=dev`
# does not run `prisma generate` (because the Prisma CLI is a devDependency).
# Copy the generated client artifacts into the runtime image.
COPY --from=backend-builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=backend-builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=backend-builder /app/prisma ./prisma
COPY --from=backend-builder /app/packages ./packages
COPY --from=backend-builder /app/frontend/src/modules/policies/list ./frontend/src/modules/policies/list

# Copy built artifacts
COPY --from=frontend-builder /app/dist ./dist
COPY --from=backend-builder /app/backend/dist ./backend/dist

# Copy runtime templates/assets required for PDF generation
COPY --from=backend-builder /app/backend/products/motor/documents/templates ./backend/dist/products/motor/documents/templates

# Create non-root user
RUN useradd -m -u 1001 nodejs
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application with automatic schema sync
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && node backend/dist/index.js"]

