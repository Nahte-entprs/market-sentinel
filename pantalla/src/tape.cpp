#include "tape.h"

#include <ArduinoJson.h>
#include <string.h>

static constexpr int TAPE_CAP = 4;
static TapeRow rows[TAPE_CAP];
static int count = 0;

static void copy_field(char *dst, size_t cap, const char *src) {
  if (!src) src = "";
  strncpy(dst, src, cap - 1);
  dst[cap - 1] = 0;
}

int tape_apply(const char *line) {
  JsonDocument doc;
  if (deserializeJson(doc, line)) return 0;
  const char *op = doc["op"] | "";
  if (strcmp(op, "quote") != 0) return 0;
  const char *symbol = doc["symbol"] | "";
  if (!symbol[0] || strlen(symbol) > 8) return -1;

  int at = -1;
  for (int i = 0; i < count; i++) {
    if (strcmp(rows[i].symbol, symbol) == 0) {
      at = i;
      break;
    }
  }
  if (at < 0) {
    if (count < TAPE_CAP) at = count++;
    else at = TAPE_CAP - 1;
  }
  copy_field(rows[at].symbol, sizeof rows[at].symbol, symbol);
  copy_field(rows[at].price, sizeof rows[at].price, doc["price"] | "");
  copy_field(rows[at].change, sizeof rows[at].change, doc["chg"] | "");
  copy_field(rows[at].volume, sizeof rows[at].volume, doc["vol"] | "");
  rows[at].n = 0;
  JsonArray px = doc["px"].as<JsonArray>();
  JsonArray vl = doc["vl"].as<JsonArray>();
  int n = 0;
  for (JsonVariant item : px) {
    if (n >= TAPE_CURVE_CAP) break;
    rows[at].px[n] = item.as<float>();
    float bar = 0;
    if (n < (int)vl.size()) bar = vl[n].as<float>();
    rows[at].vl[n] = bar < 0 ? 0 : bar;
    n++;
  }
  rows[at].n = (uint8_t)n;
  return 1;
}

int tape_count() { return count; }

const TapeRow *tape_at(int index) {
  if (index < 0 || index >= count) return nullptr;
  return &rows[index];
}
