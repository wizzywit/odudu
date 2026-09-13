# The pinned pnpm version alone, so that the fetch layer below is keyed on
# `packageManager` rather than on every edit to the root package.json. The
# version is never written down twice: package.json is the only place it
# appears.
FROM node:24-alpine AS pnpm-version
WORKDIR /pin
COPY package.json ./
RUN node -p "require('./package.json').packageManager" > /pnpm-version

# Every stage that runs pnpm derives from here, so one image build fetches it
# once. `corepack enable` installs shims only; getting pnpm actually usable
# takes two downloads, and left to itself each happens the first time a shim
# runs — that is, separately inside every stage's `pnpm install`.
#
#   1. `corepack prepare` pulls the pnpm package into COREPACK_HOME.
#   2. That package is a launcher: the first pnpm invocation then fetches the
#      platform-native binary it execs. Running pnpm once here is what pulls
#      it, and it is written beside the package as `pnpm-native`, so it is
#      carried by the same layer.
#
# Skipping step 2 leaves the second download live in each derived stage,
# which is half the problem unfixed. COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# answers the confirmation corepack would otherwise put to a tty that is not
# there.
FROM node:24-alpine AS pnpm
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY --from=pnpm-version /pnpm-version /pnpm-version
# Retried because these are plain HTTPS transfers against a public registry,
# and a socket closed mid-body surfaces as an assertion failure inside Node's
# bundled undici rather than as anything the caller retries. The retry buys
# nothing against a version that does not exist or a registry that is down —
# it is a hedge against a transient transport fault, and against nothing else.
RUN set -eu; \
    version="$(cat /pnpm-version)"; \
    for attempt in 1 2 3; do \
      if corepack prepare "$version" --activate && pnpm --version; then exit 0; fi; \
      echo "materialising $version failed (attempt $attempt of 3)" >&2; \
      sleep $((attempt * 5)); \
    done; \
    exit 1

FROM pnpm AS build
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json .npmrc ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @odudu/server build

FROM pnpm AS prod-deps
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
