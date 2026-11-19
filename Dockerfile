FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json tsconfig.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY lib/db/package.json lib/db/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    AMUSE_DATA_DIR=/data \
    AMUSE_CONTAINER=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build /app /app
# Chromium (and its system libraries) for the agent's live browser.
RUN node node_modules/playwright-core/cli.js install --with-deps chromium && rm -rf /var/lib/apt/lists/*
# Run as an unprivileged user. Docker's default seccomp profile doesn't allow Chromium's own
# sandbox, so the browser falls back to running without it and the container is the boundary.
RUN useradd --system --uid 10001 --home-dir /data amuse && mkdir -p /data && chown amuse:amuse /data
USER amuse
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "apps/server/dist/index.mjs"]
