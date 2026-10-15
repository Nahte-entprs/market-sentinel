#!/usr/bin/with-contenv bashio
set -euo pipefail

export MQTT_URL="$(bashio::config 'mqtt_url')"
export MQTT_USER="$(bashio::config 'mqtt_user')"
export MQTT_PASSWORD="$(bashio::config 'mqtt_password')"
export TZ="$(bashio::config 'tz')"
export LLAMA_SERVER_URL="$(bashio::config 'llama_server_url')"
export REMOTE_WORKER_URL="$(bashio::config 'remote_worker_url')"
export PREVIEW_UI=true
export API_PORT=8099
export CENTINELA_DATA=/data

cd /app

set +e
stop=0
child=0
shutdown() {
  stop=1
  if [[ "$child" != "0" ]]; then
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
}
trap shutdown TERM INT

while true; do
  if [[ "$stop" == "1" ]]; then
    exit 0
  fi
  npx tsx src/index.ts &
  child=$!
  wait "$child"
  code=$?
  child=0
  if [[ "$stop" == "1" ]]; then
    exit 0
  fi
  echo "[centinela] proceso terminó (código ${code}). Reinicio en 3s."
  sleep 3
done
