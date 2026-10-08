FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.25.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate && pnpm --filter @fatboy/contracts build && pnpm --filter @fatboy/api build
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
WORKDIR /app/apps/api
ENV NODE_ENV=production UPLOAD_DIR=/app/uploads
EXPOSE 3000
CMD ["node","dist/main.js"]
