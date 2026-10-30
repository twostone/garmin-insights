# Two stages. The frontend is built once on the builder's own architecture (BUILDPLATFORM): the result is static
# files, identical for every target, and building it under QEMU emulation for arm64 would only be slow.
# The runtime stage is built per target architecture. Plain Node image instead of the HA base image: no
# s6/bashio needed (the options are read from /data/options.json by the app itself), and Node >= 22.13
# is guaranteed, which node:sqlite needs.

FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY svelte.config.js vite.config.ts tsconfig.json ./
COPY project.inlang ./project.inlang
COPY messages ./messages
COPY src ./src
COPY web ./web
RUN npm run build

FROM node:24-alpine
WORKDIR /app

COPY package.json package-lock.json ./
# Fail the build (not the first start) if node:sqlite is missing. Only runtime dependencies are installed.
RUN node -e "require('node:sqlite')" \
    && npm ci --omit=dev

COPY src ./src
COPY --from=web /app/dist ./dist

# HA ingress: port 8099, only Supervisor's proxy (172.30.32.2) may connect.
# 8100 is the external listener (Bearer tokens); it only starts when HA_EXTERNAL_URL/APP_EXTERNAL_URL
# (add-on options ha_external_url/app_external_url) are set.
# /data is the app's persistent volume (included in HA backups): database, FIT files, master key.
ENV NODE_ENV=production \
    PORT=8099 \
    EXTERNAL_PORT=8100 \
    DATA_DIR=/data \
    INGRESS_ONLY_IP=172.30.32.2
EXPOSE 8099 8100
CMD ["node", "--import", "tsx", "src/server.ts"]
