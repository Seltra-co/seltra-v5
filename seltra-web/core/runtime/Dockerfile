FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV DYAD_WEB_RUNTIME=1
ENV DYAD_USER_DATA=/workspace/userData
ENV DYAD_APPS_DIR=/workspace/apps
ENV HOME=/workspace

RUN corepack enable \
    && apt-get update \
    && apt-get install -y --no-install-recommends git ripgrep chromium ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 dyad \
    && useradd --uid 10001 --gid dyad --home-dir /workspace --no-create-home --shell /usr/sbin/nologin dyad \
    && mkdir -p /workspace/userData /workspace/apps /tmp/dyad \
    && chown -R dyad:dyad /workspace /tmp/dyad

WORKDIR /opt/dyad
COPY --chown=dyad:dyad package.json package-lock.json ./
COPY --chown=dyad:dyad node_modules ./node_modules
COPY --chown=dyad:dyad dist/runtime_main.js ./runtime_main.js
COPY --chown=dyad:dyad drizzle ./drizzle

USER dyad:dyad
EXPOSE 8787
VOLUME ["/workspace"]
ENTRYPOINT ["node", "/opt/dyad/runtime_main.js"]
