FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
COPY packages/contracts ./packages/contracts
RUN cd packages/contracts && npm ci --no-audit --no-fund && npm run build
COPY api ./api
COPY engine ./engine
COPY ws ./ws
COPY db-processor ./db-processor
COPY market-maker ./market-maker
RUN for service in api engine ws db-processor market-maker; do \
        cd /app/$service && npm ci --no-audit --no-fund && npm run build \
        && npm prune --omit=dev --no-audit --no-fund || exit 1; \
    done
RUN rm -rf /app/packages/contracts/node_modules

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
RUN apk add --no-cache nginx redis tini
WORKDIR /app
COPY --from=build /app ./
COPY scripts/render-start.mjs ./scripts/render-start.mjs
COPY docker/render.nginx.conf ./docker/render.nginx.conf
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=64
ENV PORT=10000
USER node
EXPOSE 10000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "scripts/render-start.mjs"]
