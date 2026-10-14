# Builds the web app and serves it with Caddy, which also proxies /api to the API container.
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
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv
