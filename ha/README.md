# Lovelace / paquetes

1. En `configuration.yaml`:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

2. Copia `packages/centinela.yaml` a `/config/packages/`.
3. Dashboard → tres puntos → **Editor YAML** (o crea un dashboard y pega):
   - Con HACS Mushroom: `lovelace/centinela.yaml`
   - Sin HACS: `lovelace/centinela-native.yaml`
4. Reinicia HA o recarga automations + MQTT.

Las entidades `sensor.centinela_*` aparecen cuando el add-on publica discovery (Mosquitto encendido).
