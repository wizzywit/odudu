FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json .npmrc ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @odudu/server build

FROM node:24-alpine AS runtime
RUN addgroup -S odudu && adduser -S -G odudu odudu
WORKDIR /app
COPY --from=build --chown=odudu:odudu /app/apps/server/dist ./dist
COPY --from=build --chown=odudu:odudu /app/packages/db/drizzle ./drizzle
# @node-rs/argon2 is marked external to the tsup bundle (a native .node
# binary cannot be inlined into an ESM bundle), so its resolved package —
# pnpm's content-addressed store plus the workspace symlink that points into
# it — has to ride along explicitly. Neither is hoisted to the workspace
# root by default, so a plain top-level node_modules copy would miss it.
COPY --from=build --chown=odudu:odudu /app/node_modules ./node_modules
COPY --from=build --chown=odudu:odudu /app/packages/domain-identity/node_modules ./packages/domain-identity/node_modules
RUN mkdir -p node_modules/@node-rs \
  && ln -s ../../packages/domain-identity/node_modules/@node-rs/argon2 node_modules/@node-rs/argon2
ENV NODE_ENV=production \
    ODUDU_MIGRATIONS_DIR=/app/drizzle \
    ODUDU_HTTP_HOST=0.0.0.0 \
    ODUDU_HTTP_PORT=3000
USER odudu
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health/ready || exit 1
CMD ["node", "dist/main.js"]
