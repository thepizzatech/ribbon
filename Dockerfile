# Ribbon container image. Targets:
#   dev     hot-reload dev server (used by docker-compose.yml)
#   build   compiles the production server (intermediate)
#   runner  small production image, runs as the unprivileged "node" user
#
# Needs Node 22.13+ for the built-in node:sqlite module (no native add-ons to compile).

FROM node:22-bookworm-slim AS dev
WORKDIR /app
ENV DATA_DIR=/data \
    SEED_SAMPLE_DATA=true
RUN mkdir -p /data
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 8080
CMD ["npm", "run", "dev"]

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Short git SHA shown in Settings and /api/health (optional).
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT
RUN npm run build

FROM node:22-bookworm-slim AS runner
ARG GIT_COMMIT=""
ARG VERSION=""
LABEL org.opencontainers.image.title="Ribbon" \
      org.opencontainers.image.description="A family gift tracker you host yourself" \
      org.opencontainers.image.source="https://github.com/thepizzatech/ribbon" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$GIT_COMMIT
WORKDIR /app
# Production defaults: no sample data, and the family sets up the ledger on first visit.
# Ribbon speaks plain HTTP on 8080; put an HTTPS reverse proxy in front (docs/REVERSE-PROXY.md).
ENV NODE_ENV=production \
    SEED_SAMPLE_DATA=false \
    GIT_COMMIT=$GIT_COMMIT \
    HOST=0.0.0.0 \
    PORT=8080 \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=8080 \
    DATA_DIR=/data \
    NODE_NO_WARNINGS=1
# The data directory is created owned by "node" so a fresh named volume is writable.
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/.output ./.output
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", ".output/server/index.mjs"]
