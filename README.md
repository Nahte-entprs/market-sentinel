# Centinela — radar de mercado para Home Assistant OS

Centinela vigila cotizaciones, noticias, macros y Reddit **en loop**, sin gastar tokens. En el G3 ves y editas todo en la **barra lateral** de Home Assistant (panel del add-on, como Zigbee2MQTT). Los avisos llegan a Companion.

No es consejo financiero. No es un chatbot ni un broker.

## HAOS: tienda de complementos

Este GitHub es un **repositorio de complementos** (`repository.json` + carpeta `centinela/`). En el G3 no haces `git clone` a `/addons`.

Ajustes → Complementos → tienda (⋮) → **Repositorios** → pega:

```
https://github.com/Nahte-entprs/market-sentinel
```

Instala **Centinela**. Cuando suba `version` en `centinela/config.yaml`, HA ofrece **Actualizar**.

Si ya lo instalaste como complemento **local**, páralo, desinstálalo y borra `/addons/centinela` antes de usar la tienda.

El `Dockerfile` lo usa Supervisor al instalar; no hace falta Docker ni Portainer a mano.

## Dos máquinas

- **Cursor / tu PC:** `npm run dev` — worker + UI (http://127.0.0.1:38447).
- **G3 Plus (HAOS):** add-on Centinela + Mosquitto + **Mostrar en la barra lateral** + avisos Companion.

## Desarrollo (PC o cloud)

```bash
cd centinela
npm install
cd ..
npm run dev
```

- Worker: `http://127.0.0.1:18765`
- UI: `http://127.0.0.1:38447` (misma app que en HA, con proxy al worker)

## Producción en HAOS

1. Complemento **Mosquitto**. Anota usuario/clave.
2. Tienda → repositorio `https://github.com/Nahte-entprs/market-sentinel` → **Centinela** → Instalar (versión **1.5.0** o superior).
3. Opciones: `mqtt_url: mqtt://core-mosquitto:1883`, usuario/clave, `TZ=America/Santiago`.
4. Arranca el add-on. En su ficha activa **Mostrar en la barra lateral**. Abre **Centinela** (Radar, Cartera, Reddit, Ideas). No hace falta pegar Lovelace.
5. En `configuration.yaml`:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

   Copia [`ha/packages/centinela.yaml`](ha/packages/centinela.yaml) a `/config/packages/` para que Companion reciba avisos (radar + cartera).

El puerto **8099** es interno del contenedor (ingress). No choca con Zigbee2MQTT: cada add-on tiene el suyo. No publiques 8099 en el host.

MQTT sigue creando `sensor.centinela_*` por si quieres vistas Lovelace sueltas ([`ha/lovelace/centinela.yaml`](ha/lovelace/centinela.yaml) es opcional).

Node-RED es opcional ([`nodered/centinela.json`](nodered/centinela.json)).

## Tareas (una a la vez)

- **A** Macro — petróleo, USDJPY, 10Y, VIX, factores
- **B** Eventos de ticker — T0/T1, 8-K, tesis, grafo
- **C** Sentimiento — léxico + régimen
- **D** Volumen inusual + vigilante de cartera (push al teléfono)
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

- Nueva tarea: [`centinela/src/jobs.ts`](centinela/src/jobs.ts) (registro `JOBS`).
- Ticker o idea: panel del add-on (barra lateral), sin reinstalar.
- Grafo / tesis / feeds: [`centinela/data/event-graph.json`](centinela/data/event-graph.json), [`centinela/data/thesis.json`](centinela/data/thesis.json), [`centinela/data/feeds.json`](centinela/data/feeds.json).

## Hardware

Intel N150 + 8 GB junto a HAOS. Si el G3 Plus admite 16 GB, hay más margen; no es requisito.
