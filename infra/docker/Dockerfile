# The pinned pnpm version alone, so that the fetch layer below is keyed on
# `packageManager` rather than on every edit to the root package.json. The
# version is never written down twice: package.json is the only place it
# appears.
# digest of the multi-arch index; Dependabot moves it
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS pnpm-version
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
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS pnpm
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

# Every package is downloaded here, so the layer is rebuilt when the lockfile,
# the workspace settings or the root package.json change, and not on an edit
# to a package's source. The stages below install from this store offline.
FROM pnpm AS store
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN pnpm fetch

FROM store AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile --offline --ignore-scripts
RUN pnpm --filter @odudu/server build
RUN pnpm --filter @odudu/admin-console build
RUN pnpm --filter @odudu/instrument build

# The documentation that ships with the server: the image build of the docs app
# (base /docs/, noindex, no landing page) and the csp.json the server's policy
# is read from. It starts from `build` so the install above is shared, and
# nothing in the runtime image reads it but the copy below. The commit goes in
# last, so a new commit rebuilds only this step.
FROM build AS docs
ARG ODUDU_REVISION=unknown
RUN ODUDU_COMMIT="$(printf '%.7s' "$ODUDU_REVISION")" pnpm --filter @odudu/docs build:image

FROM store AS prod-deps
COPY packages packages
COPY apps apps
# --ignore-scripts is safe here: @node-rs/argon2 ships prebuilt platform
# binaries as optionalDependencies (verified against its package.json — no
# install/postinstall script selects or compiles anything), so skipping
# lifecycle scripts does not leave it half-installed.
# `pnpm fetch` leaves the whole virtual store in node_modules, devDependencies
# included, and a --prod install over it only unlinks them from the top level.
# Removing it first is what keeps the runtime image to what runs.
RUN rm -rf node_modules && pnpm install --frozen-lockfile --offline --prod --ignore-scripts

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS runtime
RUN addgroup -S odudu && adduser -S -G odudu odudu
# A named volume mounted here takes this directory's owner and mode, so
# odudu init, which runs as the odudu user, can write quickstart.env into it.
RUN mkdir -m 0700 /var/lib/odudu && chown odudu:odudu /var/lib/odudu
WORKDIR /app
COPY --chmod=0755 infra/docker/odudu /usr/local/bin/odudu
COPY --from=build --chown=odudu:odudu /app/apps/server/dist ./dist
COPY --from=build --chown=odudu:odudu /app/packages/db/drizzle ./drizzle
# The console is a static build the gateway reads once at boot. Every
# package it is built from is a devDependency of @odudu/admin-console, so
# the prod-deps stage carries none of them.
COPY --from=build --chown=odudu:odudu /app/apps/admin-console/dist ./console
# The stylesheet and fonts every rendered page links, read once at boot.
COPY --from=build --chown=odudu:odudu /app/packages/instrument/dist ./instrument
# The built documentation, served under /docs and read once at boot, with the
# csp.json its policy comes from. ODUDU_DOCS=false turns the route off.
COPY --from=docs --chown=odudu:odudu /app/apps/docs/dist/image ./docs
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
# Declared after the last COPY: a build argument that differs between builds
# invalidates the layers that follow it, and these two change on every release.
ARG ODUDU_VERSION=dev
ARG ODUDU_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/wizzywit/odudu" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version=$ODUDU_VERSION \
      org.opencontainers.image.revision=$ODUDU_REVISION
ENV ODUDU_VERSION=$ODUDU_VERSION \
    NODE_ENV=production \
    ODUDU_MIGRATIONS_DIR=/app/drizzle \
    ODUDU_CONSOLE_DIR=/app/console \
    ODUDU_INSTRUMENT_DIR=/app/instrument \
    ODUDU_DOCS_DIR=/app/docs \
    ODUDU_HTTP_HOST=0.0.0.0 \
    ODUDU_HTTP_PORT=3000
USER odudu
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health/ready || exit 1
CMD ["node", "dist/main.js"]
