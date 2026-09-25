ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-debian:bookworm
FROM ${BUILD_FROM}

# Lo construye Home Assistant Supervisor al instalar el add-on.
# En HAOS no instalas Docker ni Compose; no hay que ejecutar este archivo a mano.

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates python3 make g++ \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY data ./data
COPY tsconfig.json ./
COPY run.sh /run.sh
RUN chmod a+x /run.sh

ENV PREVIEW_UI=false
ENV CENTINELA_DATA=/data

CMD ["/run.sh"]
