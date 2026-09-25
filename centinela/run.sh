#!/usr/bin/with-contenv bashio
set -euo pipefail

export MQTT_URL="$(bashio::config 'mqtt_url')"
export MQTT_USER="$(bashio::config 'mqtt_user')"
export MQTT_PASSWORD="$(bashio::config 'mqtt_password')"
export TZ="$(bashio::config 'tz')"
export LLAMA_SERVER_URL="$(bashio::config 'llama_server_url')"
export REMOTE_WORKER_URL="$(bashio::config 'remote_worker_url')"
export PREVIEW_UI=false
export CENTINELA_DATA=/data

cd /app
exec npx tsx src/index.ts
