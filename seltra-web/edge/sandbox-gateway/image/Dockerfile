FROM node:24-bookworm-slim
ENV DYAD_WEB_RUNTIME=1
ENV DYAD_USER_DATA=/workspace/userData
ENV DYAD_APPS_DIR=/workspace/apps
ENV DYAD_TMP_DIR=/workspace/tmp
ENV HOME=/workspace
WORKDIR /opt/dyad
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep ca-certificates && rm -rf /var/lib/apt/lists/* && groupadd --gid 10001 dyad && useradd --uid 10001 --gid dyad --home-dir /workspace --no-create-home --shell /usr/sbin/nologin dyad && mkdir -p /workspace/userData /workspace/apps /workspace/tmp /opt/dyad/tmp && chown -R dyad:dyad /workspace /opt/dyad
COPY package.json package-lock.json ./
COPY node_modules ./node_modules
COPY dist/runtime/runtime_main.js ./runtime_main.js
COPY drizzle ./drizzle
USER dyad:dyad
EXPOSE 8787
ENTRYPOINT ["node", "/opt/dyad/runtime_main.js"]
