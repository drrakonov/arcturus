# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS builder

WORKDIR /app/packages/contracts
COPY packages/contracts/package*.json ./
RUN npm ci
COPY packages/contracts/tsconfig.json ./
COPY packages/contracts/src/ ./src/
RUN npm run build

WORKDIR /app/db-processor

COPY db-processor/package*.json ./
RUN npm ci

COPY db-processor/tsconfig.json ./
COPY db-processor/src/ ./src/
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime

COPY --from=builder /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=builder /app/packages/contracts/dist /app/packages/contracts/dist
WORKDIR /app/db-processor

# Only production dependencies
COPY db-processor/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/db-processor/dist ./dist

CMD ["node", "dist/index.js"]
