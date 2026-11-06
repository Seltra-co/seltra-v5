FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV DYAD_WEB_RUNTIME=1
ENV DYAD_USER_DATA=/workspace/userData
ENV DYAD_APPS_DIR=/workspace/apps
ENV HOME=/workspace
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN corepack enable \
    && apt-get update \
    && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 dyad \
    && useradd --uid 10001 --gid dyad --home-dir /workspace --no-create-home --shell /usr/sbin/nologin dyad \
    && mkdir -p /workspace/userData /workspace/apps /workspace/tmp /opt/dyad/tmp \
    && chown -R dyad:dyad /workspace /opt/dyad

WORKDIR /opt/dyad
COPY --chown=dyad:dyad package.json package-lock.json ./
COPY --chown=dyad:dyad node_modules ./node_modules
COPY --chown=dyad:dyad dist/runtime/runtime_main.js ./runtime_main.js
COPY --chown=dyad:dyad drizzle ./drizzle

RUN ./node_modules/.bin/playwright install --with-deps chromium \
    && chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"

USER dyad:dyad
EXPOSE 8787
ENTRYPOINT ["node", "/opt/dyad/runtime_main.js"]
