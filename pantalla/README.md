# Pantalla de avisos

Bandeja portátil para la JC4832W535 / JC3248W535C. Centinela no cambia: el teléfono ya recibe el aviso por Companion y esta app se lo pasa a la placa por Bluetooth LE.

## Placa

```bash
cd pantalla
pio run -t upload
pio device monitor
```

USB-C, ESP32-S3, flash 16 MB, PSRAM OPI. El monitor es el puerto serie USB.

La primera vez pinta rojo, verde y azul y espera un toque (o 8 s). En el monitor tiene que aparecer `0x3B` en la línea `[i2c]`.

Batería: LiPo 3,7 V en el JST de 1,25 mm, polaridad correcta. El USB-C carga la celda. Sin USB, el botón de batería enciende la placa. La luz baja a un mínimo y no a cero: si el integrado de al lado del conector es un IP5306, apagarla del todo corta la alimentación.

Para medir: con la placa en batería y un multímetro en serie, escribe `measure` en el monitor. Deja 30 s sin tocar. Si la placa se apaga sola, sube `BL_SLEEP_DUTY` en `include/config.h`. La pantalla se atenúa sola a los 12 s.

Otros comandos: `help`, `status`, `wake`, `dim`, `bars`, `touchlog`.

Si el rojo y el azul salen cambiados en la interfaz (las barras del arranque sí se ven bien), pon `LV_COLOR_16_SWAP` en 1 dentro de `include/lv_conf.h`. Si el toque queda al revés, cambia `TOUCH_SWAP_XY`, `TOUCH_MIRROR_X` o `TOUCH_MIRROR_Y` en `include/config.h`.

## Probar sin el teléfono

Con [nRF Connect](https://www.nordicsemi.com/Products/Development-tools/nRF-Connect-for-mobile), conecta a **Centinela**, suscríbete a la característica TX (`6E400003-…`) y escribe en RX (`6E400002-…`):

```json
{"section":"cartera","title":"NVDA","message":"Volumen 5m","at":"2026-10-09T19:03:00-03:00"}
```

La placa contesta `ok`. Sección válida: `radar`, `cartera`, `reddit`, `ideas`.

## Teléfono

Abre `pantalla/android` en Android Studio y ejecútala en el mismo teléfono que tiene Companion.

1. Acceso a notificaciones, y elige esta app.
2. Buscar pantalla, con la placa encendida al lado.
3. Activa el puente.

A partir de ahí, cada aviso de Centinela que Companion muestre (el grupo `centinela-radar`, `centinela-cartera`, `centinela-reddit` o `centinela-ideas`) entra en la pantalla. Si la placa está lejos, se queda en cola y sale al reconectar.

El reloj de la tarjeta resta 3 h a las horas en UTC (`Z`), que es como Centinela marca `at`. Si un aviso trae `-03:00`, se muestra esa hora.
