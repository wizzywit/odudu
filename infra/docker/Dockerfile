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
ENV NODE_ENV=production \
    ODUDU_MIGRATIONS_DIR=/app/drizzle \
    ODUDU_HTTP_HOST=0.0.0.0 \
    ODUDU_HTTP_PORT=3000
USER odudu
EXPOSE 3000
CMD ["node", "dist/main.js"]
