# Cloud Run variant of web.Dockerfile: Caddy listens on $PORT and proxies /api to API_URL.
FROM node:24-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @turnwise/web
COPY apps/web apps/web
# No sign-in for the demo: the persona switcher supplies the acting role.
ENV VITE_DEMO_IDENTITY=true
RUN pnpm --filter @turnwise/web build

FROM caddy:2.10-alpine
COPY deploy/Caddyfile.cloudrun /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv
