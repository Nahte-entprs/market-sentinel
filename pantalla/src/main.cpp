#include "backlight.h"
#include "ble_link.h"
#include "config.h"
#include "display.h"
#include "notice.h"
#include "store.h"
#include "tape.h"
#include "textutil.h"
#include "touch.h"
#include "ui.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <string.h>

static bool panel_ok = false;
static int64_t clock_epoch = 0;
static uint32_t clock_mark = 0;

static int64_t clock_now() {
  if (clock_epoch <= 0) return 0;
  return clock_epoch + (int64_t)((millis() - clock_mark) / 1000);
}

static void clock_observe(const char *iso) {
  int64_t epoch = 0;
  if (!parse_iso_epoch(iso, &epoch) || epoch <= 0) return;
  if (epoch + 5 < clock_now()) return;
  clock_epoch = epoch;
  clock_mark = millis();
}

static bool take_clock(const char *line) {
  if (!line || !strstr(line, "clock")) return false;
  JsonDocument doc;
  if (deserializeJson(doc, line)) return false;
  const char *op = doc["op"] | "";
  if (strcmp(op, "clock") != 0) return false;
  clock_observe(doc["at"] | "");
  return true;
}

static void expire_notices() {
  if (store_prune(clock_now()) && panel_ok) ui_reload();
}

static void print_help() {
  Serial.println("help | status | wake | dim | measure | bars | touchlog");
  Serial.println("o una linea JSON {\"section\":\"radar\",\"title\":\"...\",\"message\":\"...\",\"at\":\"...\"}");
}

static void print_status() {
  Serial.printf("[estado] avisos %d  sin leer %d  ble %s  luz %s duty %d\n", store_count(), store_unread(),
                ble_connected() ? "conectado" : "no", backlight_asleep() ? "sueno" : "despierto", backlight_duty());
  Serial.printf("[estado] heap %u  psram %u\n", (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getFreePsram());
}

static void ingest(const char *line, bool from_ble) {
  if (take_clock(line)) {
    expire_notices();
    if (from_ble) ble_ack("ok\n");
    return;
  }
  int quote = tape_apply(line);
  if (quote != 0) {
    if (quote < 0) {
      Serial.println("[cinta] rechazada");
      if (from_ble) ble_ack("err\n");
      return;
    }
    if (panel_ok) {
      ui_note_quote();
      ui_reload();
    }
    Serial.printf("[cinta] %s\n", tape_count() ? tape_at(tape_count() - 1)->symbol : "?");
    if (from_ble) ble_ack("ok\n");
    return;
  }
  NoticeDraft draft;
  char err[32];
  if (!notice_from_json(line, draft, err, sizeof err)) {
    Serial.printf("[aviso] rechazado (%s)\n", err);
    if (from_ble) ble_ack("err\n");
    return;
  }
  AddResult result = store_add(draft);
  if (result == AddResult::Error) {
    Serial.println("[aviso] no se pudo guardar");
    if (from_ble) ble_ack("err\n");
    return;
  }
  if (result == AddResult::Ok) {
    clock_observe(draft.at);
    expire_notices();
    bool still = false;
    if (draft.id[0]) {
      for (int i = 0; i < store_count(); i++) {
        const Notice *n = store_at(i);
        if (n && strcmp(n->ext_id, draft.id) == 0) still = true;
      }
    } else {
      still = true;
    }
    if (still) {
      backlight_activity();
      if (panel_ok) ui_reload();
      Serial.printf("[aviso] %s | %s\n", draft.section, draft.title);
    }
  }
  if (from_ble) ble_ack("ok\n");
}

static void handle_serial() {
  static char buf[LINE_ASM_CAP];
  static size_t len = 0;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c != '\n' && c != '\r') {
      if (len + 1 < sizeof buf) buf[len++] = c;
      continue;
    }
    if (len == 0) continue;
    buf[len] = 0;
    len = 0;
    if (strcmp(buf, "help") == 0) print_help();
    else if (strcmp(buf, "status") == 0) print_status();
    else if (strcmp(buf, "wake") == 0) backlight_force_wake();
    else if (strcmp(buf, "dim") == 0) backlight_force_dim();
    else if (strcmp(buf, "measure") == 0) backlight_measure();
    else if (strcmp(buf, "bars") == 0) display_color_bars();
    else if (strcmp(buf, "touchlog") == 0) display_touch_log(8000);
    else if (buf[0] == '{') ingest(buf, false);
    else Serial.println("comando desconocido. help");
  }
}

void setup() {
  Serial.begin(115200);
  uint32_t wait = millis() + 1500;
  while (!Serial && (int32_t)(wait - millis()) > 0) delay(10);

  Serial.println();
  Serial.println("Centinela pantalla");
  Serial.println("Bateria: LiPo 3.7 V en el JST 1.25 mm, polaridad correcta. El USB-C carga.");
  Serial.println("Si no hay USB, el boton de bateria enciende la placa. La luz no se apaga del todo");
  Serial.println("para que un IP5306 no corte la carga. Mide con el comando: measure");

  backlight_begin();
  touch_begin();
  touch_scan_i2c();
  panel_ok = display_begin();
  if (!store_begin()) Serial.println("[flash] sin LittleFS, los avisos se quedan en RAM");
  if (panel_ok) ui_init();
  ble_begin();
  print_help();
}

void loop() {
  handle_serial();
  static bool last_link = false;
  bool link = ble_connected();
  if (link != last_link) {
    last_link = link;
    if (panel_ok) ui_set_link(link);
  }
  static char line[LINE_ASM_CAP];
  while (ble_take_line(line, sizeof line)) ingest(line, true);
  if (panel_ok) {
    ui_pump();
    display_pump();
  }
  static uint32_t last_prune = 0;
  if (millis() - last_prune >= 1000) {
    last_prune = millis();
    expire_notices();
  }
  backlight_tick();
  delay(5);
}
