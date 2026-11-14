FROM node:24-bookworm-slim
ARG BUILD_SHA
ENV BUILD_SHA=$BUILD_SHA
ENV DYAD_WEB_RUNTIME=1
ENV DYAD_WEB_RUNTIME_ENTRY=1
ENV DYAD_USER_DATA=/workspace/userData
ENV DYAD_APPS_DIR=/workspace/apps
ENV DYAD_TMP_DIR=/workspace/tmp
ENV HOME=/workspace
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /opt/dyad
RUN apt-get update && apt-get install -y --no-install-recommends git procps ripgrep curl iproute2 ca-certificates && rm -rf /var/lib/apt/lists/* && groupadd --gid 10001 dyad && useradd --uid 10001 --gid dyad --home-dir /workspace --no-create-home --shell /usr/sbin/nologin dyad && mkdir -p /workspace/userData /workspace/apps /workspace/tmp /opt/dyad/tmp && chown -R dyad:dyad /workspace /opt/dyad
RUN printf '%s\n' "$BUILD_SHA" > /opt/dyad/BUILD_SHA
COPY package.json package-lock.json ./
COPY node_modules ./node_modules
RUN node ./node_modules/playwright-core/cli.js install --with-deps chromium && chown -R dyad:dyad /ms-playwright
COPY bootstrap.mjs ./bootstrap.mjs
COPY dist/runtime/runtime_main.js ./dist/runtime/runtime_main.js
COPY --chown=dyad:dyad worker ./worker
COPY drizzle ./drizzle
COPY --chown=dyad:dyad scaffold ./scaffold
COPY --chown=dyad:dyad assets/icon/seltra-mark.png ./assets/icon/seltra-mark.png
USER dyad:dyad
ENV RUNTIME_RPC_HOST=127.0.0.1
ENV RUNTIME_RPC_PORT=8787
ENV PORT=8788
EXPOSE 8787 8788
ENTRYPOINT ["node", "/opt/dyad/bootstrap.mjs"]
