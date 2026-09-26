# Lovelace / paquetes

1. En `configuration.yaml`:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

2. Copia `ha/packages/centinela.yaml` a `/config/packages/`.
3. En **tu** dashboard de la barra lateral: tres puntos → **Editor YAML** y pega [`ha/lovelace/centinela-native.yaml`](lovelace/centinela-native.yaml). Las pestañas (Resumen, Reddit, Ideas) son `views`. Lovelace no se actualiza solo al actualizar el add-on.
4. Actualiza el complemento a **1.2.0** para que MQTT traiga tablas, comentarios retenidos y léxico. Luego Run **WSB daily** y **Reddit subs**.

Las entidades `sensor.centinela_*` aparecen cuando el add-on publica discovery (Mosquitto encendido).
