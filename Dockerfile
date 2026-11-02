# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
FROM node:24-alpine AS build

WORKDIR /app

# Install dependencies first so Docker can cache this layer.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the project and produce the static site.
COPY . .
RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM nginx:1.29-alpine AS runtime

# Static-site config: gzip, long-lived immutable assets, SPA fallback.
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# adapter-static writes the deployable site to /app/build.
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
