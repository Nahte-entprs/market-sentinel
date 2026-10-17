#include "store.h"

#include <LittleFS.h>
#include <string.h>

static const uint32_t MAGIC = 0x434E5431;
static const char *PATH = "/notices.bin";
static const char *TMP = "/notices.tmp";

static Notice items[NOTICE_CAP];
static uint16_t count = 0;
static uint32_t next_id = 10;
static bool fs_ok = false;

struct FileHeader {
  uint32_t magic;
  uint32_t count;
  uint32_t next_id;
};

static void seed_one(const char *section, const char *title, const char *message, const char *at) {
  if (count >= NOTICE_CAP) return;
  Notice &n = items[count++];
  memset(&n, 0, sizeof n);
  n.id = next_id++;
  n.unread = 1;
  n.demo = 1;
  strncpy(n.section, section, sizeof n.section - 1);
  strncpy(n.title, title, sizeof n.title - 1);
  strncpy(n.message, message, sizeof n.message - 1);
  strncpy(n.at, at, sizeof n.at - 1);
}

static void seed_demos() {
  count = 0;
  next_id = 10;
  seed_one("radar", "Régimen en observación",
           "El radar no marca crisis. Este aviso de prueba vive en la placa hasta que llegue uno real.",
           "2026-10-09T15:00:00-03:00");
  seed_one("cartera", "NVDA volumen",
           "Volumen 5m por encima de lo habitual.",
           "2026-10-09T15:04:00-03:00");
  seed_one("reddit", "Reddit · NVDA, AMD",
           "NVDA: 120 en 24h, 18 la última hora. Aviso de prueba.",
           "2026-10-09T15:08:00-03:00");
  seed_one("ideas", "Tesis de semiconductores",
           "Un claim de prueba para ver la tarjeta completa al tocarla.",
           "2026-10-09T15:12:00-03:00");
}

static bool persist() {
  if (!fs_ok) return true;
  File f = LittleFS.open(TMP, "w");
  if (!f) return false;
  FileHeader h{MAGIC, count, next_id};
  bool ok = f.write((const uint8_t *)&h, sizeof h) == sizeof h;
  if (ok && count) ok = f.write((const uint8_t *)items, sizeof(Notice) * count) == sizeof(Notice) * count;
  f.close();
  if (!ok) {
    LittleFS.remove(TMP);
    return false;
  }
  LittleFS.remove(PATH);
  return LittleFS.rename(TMP, PATH);
}

static bool load() {
  File f = LittleFS.open(PATH, "r");
  if (!f) return false;
  FileHeader h{};
  if (f.read((uint8_t *)&h, sizeof h) != sizeof h || h.magic != MAGIC || h.count > NOTICE_CAP) {
    f.close();
    return false;
  }
  if (h.count && f.read((uint8_t *)items, sizeof(Notice) * h.count) != sizeof(Notice) * h.count) {
    f.close();
    return false;
  }
  f.close();
  count = (uint16_t)h.count;
  next_id = h.next_id < 10 ? 10 : h.next_id;
  return true;
}

bool store_begin() {
  fs_ok = LittleFS.begin(true, "/littlefs", 10, "spiffs");
  if (!fs_ok || !load() || count == 0) {
    seed_demos();
    persist();
  }
  return fs_ok;
}

static void drop_demos() {
  uint16_t w = 0;
  for (uint16_t i = 0; i < count; i++) {
    if (items[i].demo) continue;
    if (w != i) items[w] = items[i];
    w++;
  }
  count = w;
}

AddResult store_add(const NoticeDraft &draft) {
  if (draft.id[0]) {
    for (uint16_t i = 0; i < count; i++) {
      if (!items[i].demo && strcmp(items[i].ext_id, draft.id) == 0) return AddResult::Duplicate;
    }
  }
  drop_demos();
  if (count == NOTICE_CAP) count--;
  memmove(&items[1], &items[0], sizeof(Notice) * count);
  count++;
  Notice &n = items[0];
  memset(&n, 0, sizeof n);
  n.id = next_id++;
  n.unread = 1;
  n.demo = 0;
  strncpy(n.ext_id, draft.id, sizeof n.ext_id - 1);
  strncpy(n.section, draft.section, sizeof n.section - 1);
  strncpy(n.title, draft.title, sizeof n.title - 1);
  strncpy(n.message, draft.message, sizeof n.message - 1);
  strncpy(n.at, draft.at, sizeof n.at - 1);
  if (!persist()) return AddResult::Error;
  return AddResult::Ok;
}

bool store_mark_read(uint32_t id) {
  for (uint16_t i = 0; i < count; i++) {
    if (items[i].id != id || !items[i].unread) continue;
    items[i].unread = 0;
    persist();
    return true;
  }
  return false;
}

int store_count() { return count; }

int store_unread() {
  int n = 0;
  for (uint16_t i = 0; i < count; i++)
    if (items[i].unread) n++;
  return n;
}

const Notice *store_at(int index) {
  if (index < 0 || index >= count) return nullptr;
  return &items[index];
}

const Notice *store_find(uint32_t id) {
  for (uint16_t i = 0; i < count; i++)
    if (items[i].id == id) return &items[i];
  return nullptr;
}
