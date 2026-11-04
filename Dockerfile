# syntax=docker/dockerfile:1
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY apps apps
COPY packages packages
RUN npm run build
# Keep only runtime dependencies for the API, worker and migration runner.
RUN npm prune --omit=dev

# API, worker and migrations run from this image with different commands.
FROM node:24-slim AS server
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api ./apps/api
COPY --from=build --chown=node:node /app/apps/worker ./apps/worker
COPY --from=build --chown=node:node /app/packages ./packages
USER node

# Static web app, with /api proxied to the API service so the browser sees one origin.
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
