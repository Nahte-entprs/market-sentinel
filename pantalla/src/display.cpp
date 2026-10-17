#include "display.h"

#include "backlight.h"
#include "config.h"
#include "touch.h"

#include <Arduino.h>
#include <Arduino_GFX_Library.h>
#include <Preferences.h>
#include <string.h>
#include <esp_heap_caps.h>
#include <lvgl.h>

static Arduino_GFX *panel = nullptr;
static lv_disp_draw_buf_t draw_buf;
static lv_disp_drv_t disp_drv;
static lv_indev_drv_t indev_drv;
static bool lv_ready = false;

// Varias ventanas seguidas no avanzan en este panel: solo queda el ultimo
// trozo, pegado al borde. Un solo envio de 320x480 pinta el cristal entero.
static uint16_t *phys_buf = nullptr;

static void blit_rotated(const uint16_t *src) {
  if (!phys_buf) {
    phys_buf = (uint16_t *)heap_caps_malloc((size_t)PANEL_W * PANEL_H * sizeof(uint16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!phys_buf) {
      Serial.println("[panel] sin buffer de giro");
      return;
    }
  }
  uint16_t *dst = phys_buf;
  for (int py = 0; py < PANEL_H; py++) {
#if DISPLAY_ROTATION == 3
    int lx = PANEL_H - 1 - py;
    for (int px = 0; px < PANEL_W; px++) dst[px] = src[(size_t)(PANEL_W - 1 - px) * SCREEN_W + lx];
#elif DISPLAY_ROTATION == 2
    const uint16_t *row = src + (size_t)(PANEL_H - 1 - py) * SCREEN_W;
    for (int px = 0; px < PANEL_W; px++) dst[px] = row[PANEL_W - 1 - px];
#elif DISPLAY_ROTATION == 1
    int lx = PANEL_H - 1 - py;
    for (int px = 0; px < PANEL_W; px++) dst[px] = src[(size_t)px * SCREEN_W + lx];
#else
    memcpy(dst, src + (size_t)py * PANEL_W, PANEL_W * sizeof(uint16_t));
#endif
    dst += PANEL_W;
  }
  panel->draw16bitRGBBitmap(0, 0, phys_buf, PANEL_W, PANEL_H);
}

static bool selftest_pending() {
  Preferences prefs;
  if (!prefs.begin("pantalla", true)) return true;
  bool done = prefs.getBool("selftest", false);
  prefs.end();
  return !done;
}

static void selftest_mark() {
  Preferences prefs;
  if (!prefs.begin("pantalla", false)) return;
  prefs.putBool("selftest", true);
  prefs.end();
}

static void flush_cb(lv_disp_drv_t *drv, const lv_area_t *, lv_color_t *color_p) {
  blit_rotated((const uint16_t *)&color_p->full);
  lv_disp_flush_ready(drv);
}

static void touch_cb(lv_indev_drv_t *, lv_indev_data_t *data) {
  int x = 0;
  int y = 0;
  if (touch_read(x, y)) {
    data->state = LV_INDEV_STATE_PR;
    data->point.x = (lv_coord_t)x;
    data->point.y = (lv_coord_t)y;
    backlight_activity();
  } else {
    data->state = LV_INDEV_STATE_REL;
  }
}

static bool lvgl_start() {
  lv_init();
  size_t px = (size_t)SCREEN_W * (size_t)SCREEN_H;
  lv_color_t *buf = (lv_color_t *)heap_caps_malloc(px * sizeof(lv_color_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!buf) buf = (lv_color_t *)malloc(px * sizeof(lv_color_t));
  if (!buf) {
    Serial.println("[panel] sin buffer");
    return false;
  }
  memset(buf, 0, px * sizeof(lv_color_t));
  lv_disp_draw_buf_init(&draw_buf, buf, nullptr, px);
  lv_disp_drv_init(&disp_drv);
  disp_drv.hor_res = SCREEN_W;
  disp_drv.ver_res = SCREEN_H;
  disp_drv.flush_cb = flush_cb;
  disp_drv.draw_buf = &draw_buf;
  disp_drv.full_refresh = 1;
  lv_disp_drv_register(&disp_drv);

  lv_indev_drv_init(&indev_drv);
  indev_drv.type = LV_INDEV_TYPE_POINTER;
  indev_drv.read_cb = touch_cb;
  lv_indev_drv_register(&indev_drv);
  lv_ready = true;
  return true;
}

static void wait_touch() {
  Serial.println("[panel] toca la pantalla para seguir (8 s)");
  uint32_t until = millis() + 8000;
  while ((int32_t)(until - millis()) > 0) {
    int x = 0;
    int y = 0;
    if (touch_read(x, y)) {
      Serial.printf("[touch] %d %d\n", x, y);
      backlight_activity();
      return;
    }
    delay(30);
  }
  Serial.println("[panel] sigo sin toque");
}

bool display_begin() {
  auto *bus = new Arduino_ESP32QSPI(PIN_CS, PIN_CLK, PIN_D0, PIN_D1, PIN_D2, PIN_D3);
  panel = new Arduino_AXS15231B(bus, GFX_NOT_DEFINED, 0, false, PANEL_W, PANEL_H);
  if (!panel->begin(40000000)) {
    Serial.println("[panel] no arranco");
    return false;
  }
  if (selftest_pending()) {
    display_color_bars();
    panel->fillScreen(RGB565_BLACK);
    panel->fillRect(30, 220, 260, 10, RGB565_WHITE);
    wait_touch();
    selftest_mark();
  }
  panel->fillScreen(RGB565_BLACK);
  Serial.printf("[panel] listo  %u x %u  psram %u\n", SCREEN_W, SCREEN_H, (unsigned)ESP.getFreePsram());
  return lvgl_start();
}

void display_color_bars() {
  if (!panel) return;
  panel->fillScreen(RGB565_RED);
  delay(300);
  panel->fillScreen(RGB565_GREEN);
  delay(300);
  panel->fillScreen(RGB565_BLUE);
  delay(300);
}

void display_touch_log(uint32_t ms) {
  Serial.println("[touch] registrando");
  uint32_t until = millis() + ms;
  while ((int32_t)(until - millis()) > 0) {
    int x = 0;
    int y = 0;
    if (touch_read(x, y)) Serial.printf("[touch] %d %d\n", x, y);
    display_pump();
    delay(30);
  }
  Serial.println("[touch] fin");
}

void display_pump() {
  if (lv_ready) lv_timer_handler();
}
