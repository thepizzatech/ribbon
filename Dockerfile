# Ribbon container image. Targets:
#   dev     hot-reload dev server (used by docker-compose.yml)
#   build   compiles the production server (intermediate)
#   runner  small production image, runs as the unprivileged "node" user
#
# Needs Node 22.13+ for the built-in node:sqlite module (no native add-ons to compile).

FROM node:22-bookworm-slim AS dev
WORKDIR /app
ENV DATA_DIR=/data
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
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
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
