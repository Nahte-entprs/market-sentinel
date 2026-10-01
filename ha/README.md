# Lovelace / paquetes

1. En `configuration.yaml`:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

2. Copia `ha/packages/centinela.yaml` a `/config/packages/` (incluye avisos Companion de radar y de cartera).
3. HACS: **Mushroom** y **[auto-entities](https://github.com/thomasloven/lovelace-auto-entities)**.
4. En **tu** dashboard de la barra lateral: tres puntos → **Editor YAML** y pega [`ha/lovelace/centinela.yaml`](lovelace/centinela.yaml). Pestañas: **Radar** y **Cartera**. Lovelace no se actualiza solo al actualizar el add-on.
5. Actualiza el complemento a **1.3.0** (MQTT: listas holding/priority/watch, formulario guardar/quitar/subir/bajar, job fundamentals). Los tickers que ya tenías pasan a Watchlist; recategorizas desde el teléfono.

Las entidades `sensor.centinela_*` aparecen cuando el add-on publica discovery (Mosquitto encendido).

Fallback sin custom cards: [`ha/lovelace/centinela-native.yaml`](lovelace/centinela-native.yaml) (sin pestaña Cartera).
