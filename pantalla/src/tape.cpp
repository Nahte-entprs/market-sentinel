#include "tape.h"

#include <ArduinoJson.h>
#include <string.h>

static TapeRow rows[1];
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

  int at = 0;
  count = 1;
  memset(&rows[0], 0, sizeof rows[0]);
  copy_field(rows[at].symbol, sizeof rows[at].symbol, symbol);
  copy_field(rows[at].price, sizeof rows[at].price, doc["price"] | "");
  copy_field(rows[at].change, sizeof rows[at].change, doc["chg"] | "");
  copy_field(rows[at].volume, sizeof rows[at].volume, doc["vol"] | "");
  rows[at].t0 = doc["t0"] | 0;
  rows[at].t1 = doc["t1"] | 0;
  float level = doc["lv"] | 0.0f;
  rows[at].level = level > 0 ? level : 0;
  rows[at].n = 0;
  JsonArray idx = doc["i"].as<JsonArray>();
  JsonArray px = doc["px"].as<JsonArray>();
  JsonArray vl = doc["vl"].as<JsonArray>();
  JsonArray va = doc["va"].as<JsonArray>();
  int n = 0;
  int count_px = (int)px.size();
  for (int k = 0; k < count_px && n < TAPE_SLOTS; k++) {
    int slot = idx ? (int)idx[k].as<int>() : k;
    if (slot < 0 || slot >= TAPE_SLOTS) continue;
    if (px[k].isNull()) continue;
    rows[at].slot[n] = (uint8_t)slot;
    rows[at].px[n] = px[k].as<float>();
    float bar = 0;
    if (k < (int)vl.size() && !vl[k].isNull()) bar = vl[k].as<float>();
    rows[at].vl[n] = bar < 0 ? 0 : bar;
    float avg = 0;
    if (k < (int)va.size() && !va[k].isNull()) avg = va[k].as<float>();
    rows[at].va[n] = avg < 0 ? 0 : avg;
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
