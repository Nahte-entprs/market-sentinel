# Centinela — radar de mercado para Home Assistant OS

Centinela vigila cotizaciones, noticias, macros y Reddit **en loop**, sin gastar tokens. En el mini PC **no hay web aparte**: ves y editas todo en un dashboard de Lovelace (Mushroom o cards nativas).

No es consejo financiero. No es un chatbot ni un broker.

## HAOS: no usas Docker a mano

El G3 Plus corre **Home Assistant OS**. No instalas Docker Engine ni `docker compose`.

El `Dockerfile` y `config.yaml` de la raíz existen porque así es un **add-on local**: Supervisor (el gestor de complementos de HAOS) los usa al pulsar Instalar. Por debajo HAOS aísla los add-ons; tú solo ves Ajustes → Complementos.

No hace falta Portainer ni SSH con Docker.

## Dos máquinas

- **Cursor / tu PC:** desarrollas y (si quieres) ves la maqueta Lovelace con `npm run dev`.
- **G3 Plus (HAOS):** add-on Centinela + Mosquitto + dashboard Lovelace + avisos Companion.

## Desarrollo (PC o cloud)

```bash
npm install
npm run dev
```

- Worker: `http://127.0.0.1:18765`
- Maqueta: `http://127.0.0.1:38447` (banner ámbar: *no es producción*)

## Producción en HAOS

1. HACS → **Mushroom** (opcional; hay [`ha/lovelace/centinela-native.yaml`](ha/lovelace/centinela-native.yaml)).
2. Complemento **Mosquitto**. Anota usuario/clave.
3. Copia **todo este repo** a `/addons/centinela` (Samba `addons` o git en la Terminal SSH).
4. Ajustes → Complementos → menú → **Complementos locales** → Centinela → Instalar.
5. Opciones: `mqtt_url: mqtt://core-mosquitto:1883`, usuario/clave, `TZ=America/Santiago`.
6. En `configuration.yaml`:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

   Copia [`ha/packages/centinela.yaml`](ha/packages/centinela.yaml) a `/config/packages/`.
7. Nuevo dashboard: pega [`ha/lovelace/centinela.yaml`](ha/lovelace/centinela.yaml).
8. Arranca el add-on. Debe aparecer el dispositivo **Centinela** (MQTT).
9. Tickers e ideas en Lovelace. Los avisos van a la app **Companion**.

Node-RED es opcional ([`nodered/centinela.json`](nodered/centinela.json)). El add-on **no publica puerto de UI**.

## Tareas (una a la vez)

- **A** Macro — petróleo, USDJPY, 10Y, VIX, factores
- **B** Eventos de ticker — T0/T1, 8-K, tesis, grafo
- **C** Sentimiento — léxico + régimen
- **D** Volumen inusual
- **E** Reddit rising (nunca alerta HIGH por sí solo)
- Ideas — apoyar / refutar tus claims
- Régimen NORMAL → CRISIS, briefing 2 h, snapshots T+

## Fuentes

T0 oficiales (SEC, Fed, EIA) → T1 wires → T2 Google News (eco, no first-alert) → T3 WSB.

## LLM (opcional, no bloquea avisos)

Las alertas salen con plantilla. Si más adelante hay un `llama-server` en la LAN:

```
llama_server_url: http://192.168.x.x:8080
```

en las opciones del add-on. Ventana de 10 min; si no hay modelo, no pasa nada.

## Extender

- Nueva tarea: `src/jobs.ts` (registro `JOBS`).
- Ticker o idea: dashboard HA, sin reinstalar.
- Grafo / tesis / feeds: [`data/event-graph.json`](data/event-graph.json), [`data/thesis.json`](data/thesis.json), [`data/feeds.json`](data/feeds.json).

## Hardware

Intel N150 + 8 GB junto a HAOS. Si el G3 Plus admite 16 GB, hay más margen; no es requisito.
