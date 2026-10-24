FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
ARG SERVICE
WORKDIR /app/packages/contracts
COPY packages/contracts/package*.json ./
RUN npm ci --no-audit --no-fund
COPY packages/contracts/tsconfig.json ./
COPY packages/contracts/src ./src
RUN npm run build
WORKDIR /app/${SERVICE}
COPY ${SERVICE}/package*.json ./
RUN npm ci --no-audit --no-fund
COPY ${SERVICE}/tsconfig.json ./
COPY ${SERVICE}/src ./src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
ARG SERVICE
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=256
COPY --from=build /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist /app/packages/contracts/dist
WORKDIR /app/${SERVICE}
COPY --from=build /app/${SERVICE}/package.json ./package.json
COPY --from=build /app/${SERVICE}/node_modules ./node_modules
COPY --from=build /app/${SERVICE}/dist ./dist
RUN mkdir -p /app/state && chown node:node /app/state
USER node
CMD ["node", "dist/index.js"]
