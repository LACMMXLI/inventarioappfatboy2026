FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@11.25.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @fatboy/contracts build && pnpm --filter @fatboy/web build
FROM nginx:1.28-alpine
COPY infra/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
ENV API_UPSTREAM=http://api:3000 NGINX_ENVSUBST_FILTER=^API_UPSTREAM$
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
