#pragma once

// JC4832W535 / JC3248W535C — ESP32-S3, AXS15231B QSPI.
// El cristal es 320x480. MADCTL no gira este panel: la imagen se rota
// en software. 1 = horizontal, 3 = horizontal al reves.
// Si el texto queda cabeza abajo, cambia 1 por 3.

#define PANEL_W 320
#define PANEL_H 480
#define DISPLAY_ROTATION 1

#if DISPLAY_ROTATION == 1 || DISPLAY_ROTATION == 3
#define SCREEN_W 480
#define SCREEN_H 320
#else
#define SCREEN_W PANEL_W
#define SCREEN_H PANEL_H
#endif

#define PIN_BL 1
#define PIN_CS 45
#define PIN_CLK 47
#define PIN_D0 21
#define PIN_D1 48
#define PIN_D2 40
#define PIN_D3 39

#define PIN_SDA 4
#define PIN_SCL 8
#define TOUCH_ADDR 0x3B

#define TOUCH_SWAP_XY 0
#define TOUCH_MIRROR_X 0
#define TOUCH_MIRROR_Y 0

// America/Santiago. nowIso() de Centinela va en UTC (sufijo Z).
#define TZ_OFFSET_MIN (-180)

// La pantalla se atenua sola. No bajar a 0: un IP5306 (power bank)
// apaga la placa si el consumo cae demasiado.
#define SLEEP_MS 12000
#define BL_AWAKE_DUTY 210
#define BL_SLEEP_DUTY 28
#define MEASURE_MS 30000

#define NOTICE_CAP 80
#define NOTICE_KEEP_SEC 600
#define TITLE_CHARS 80
#define MESSAGE_CHARS 180
#define LINE_ASM_CAP 1600

#define BLE_NAME "Centinela"
