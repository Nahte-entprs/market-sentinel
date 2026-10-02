ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:bookworm
FROM ${BUILD_FROM}

# Lo construye Home Assistant Supervisor al instalar el add-on.

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates python3 make g++ \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY ui ./ui
COPY src ./src
COPY data ./data
RUN npm ci \
    && npm run build:ui \
    && npm prune --omit=dev
COPY run.sh /run.sh
RUN chmod a+x /run.sh

ENV PREVIEW_UI=true
ENV API_PORT=8099
ENV CENTINELA_DATA=/data

CMD ["/run.sh"]
