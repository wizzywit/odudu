FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json .npmrc ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @odudu/server build

FROM node:24-alpine AS prod-deps
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages packages
COPY apps apps
# --ignore-scripts is safe here: @node-rs/argon2 ships prebuilt platform
# binaries as optionalDependencies (verified against its package.json — no
# install/postinstall script selects or compiles anything), so skipping
# lifecycle scripts does not leave it half-installed.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:24-alpine AS runtime
RUN addgroup -S odudu && adduser -S -G odudu odudu
WORKDIR /app
COPY --from=build --chown=odudu:odudu /app/apps/server/dist ./dist
COPY --from=build --chown=odudu:odudu /app/packages/db/drizzle ./drizzle
# @node-rs/argon2 is marked external to the tsup bundle (a native .node
# binary cannot be inlined into an ESM bundle), so its resolved package has
# to ride along explicitly. It's a dependency of packages/domain-identity,
# not of @odudu/server, so pnpm's isolated linker would otherwise nest it
# under packages/domain-identity/node_modules — several directories below
# where Node's resolution looks from a file under /app. The root
# pnpm-workspace.yaml's `publicHoistPattern: ['@node-rs/argon2*']` hoists it
# (and its per-platform sibling package) into this node_modules directly, so
# a bare `import '@node-rs/argon2'` resolves with no hand-written symlink.
# (pnpm 12.3.4, pinned by this repo, reads this setting from
# pnpm-workspace.yaml, not .npmrc — a plain .npmrc entry was silently
# ignored for workspace installs.) This
# node_modules comes from a dedicated --prod install (see the prod-deps
# stage), not from the build stage, so it carries none of the workspace's
# devDependencies (tsup, vitest, eslint, typescript, turbo,
# dependency-cruiser, stryker, ...).
COPY --from=prod-deps --chown=odudu:odudu /app/node_modules ./node_modules
ENV NODE_ENV=production \
    ODUDU_MIGRATIONS_DIR=/app/drizzle \
    ODUDU_HTTP_HOST=0.0.0.0 \
    ODUDU_HTTP_PORT=3000
USER odudu
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health/ready || exit 1
CMD ["node", "dist/main.js"]
