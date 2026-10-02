# Lovelace / paquetes

La UI principal es el panel del add-on (**Mostrar en la barra lateral**). Este paquete solo sirve para avisos Companion.

1. En `configuration.yaml`:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

2. Copia `ha/packages/centinela.yaml` a `/config/packages/` (radar `centinela/alert` y cartera `centinela/ticker_alert`).
3. Actualiza el complemento a **1.4.0** y activa el sidebar.

YAML Lovelace en `ha/lovelace/` es **opcional** (sensores MQTT). Ya no hay que re-pegarlo para usar Centinela.
