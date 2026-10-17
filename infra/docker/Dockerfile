# syntax=docker/dockerfile:1
# One multi-stage Dockerfile for every Node service. Targets: migrate, api, worker, web.

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm CI=true NEXT_TELEMETRY_DISABLED=1
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@12.11.2 && apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Manifests first so the dependency layer is cached until a package.json or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/scanner-agent/package.json apps/scanner-agent/
COPY packages/connectors/package.json packages/connectors/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/services/package.json packages/services/
COPY tests/integration/package.json tests/integration/
COPY tests/e2e/package.json tests/e2e/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @creatoros/api build && pnpm --filter @creatoros/worker build && pnpm --filter @creatoros/web build

# ---- shared runtime base: Node + a Postgres 17 client (pg_dump/pg_restore must be >= the server version) ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 \
 && apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN mkdir -p /data && chown node:node /data

FROM runtime AS app
COPY --from=build --chown=node:node /app /app
USER node

FROM app AS migrate
CMD ["node", "apps/api/dist/migrate.js"]

FROM app AS api
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

FROM app AS worker
CMD ["node", "apps/worker/dist/main.js"]

# ---- web: Next.js standalone output (no dev dependencies, no sources) ----
FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
