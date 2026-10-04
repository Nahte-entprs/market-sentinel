# Lovelace / paquetes

La UI principal es el panel del add-on (**Mostrar en la barra lateral**). Este paquete solo sirve para avisos al teléfono.

## Avisos: Centinela → HA → Companion

El add-on no habla con el teléfono. Publica MQTT; Home Assistant reenvía a Companion.

```
sección (radar / cartera / reddit / ideas)
    → MQTT topic centinela/notify
    → automation del paquete
    → notify.notify (todas las apps Companion)
    → toque abre /2e00f8dc_centinela?tab=<sección>
```

1. En `configuration.yaml`:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

2. Copia `ha/packages/centinela.yaml` a `/config/packages/` (sustituye el archivo anterior: las automations sueltas de `alert` / `ticker_alert` / `digest` / `CRISIS` ya no hacen falta; todo sale por `centinela/notify`).
3. Si instalaste Centinela desde GitHub y no como add-on local, cambia `addon_slug` en el YAML al slug de ingress (Ajustes → Complementos → Centinela).
4. Actualiza el complemento a **1.5.0** y activa el sidebar.
5. Recarga automations. Prueba con **Desarrollador → MQTT → publicar** un JSON en `centinela/notify`:

```json
{"section":"cartera","title":"Prueba","message":"Volumen 5m","url":"","at":"2026-01-01T00:00:00Z"}
```

Para un solo teléfono usa `notify.mobile_app_<dispositivo>` en lugar de `notify.notify`.

YAML Lovelace en `ha/lovelace/` es **opcional** (sensores MQTT). Ya no hay que re-pegarlo para usar Centinela.
