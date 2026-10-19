#include "store.h"

#include "config.h"
#include "textutil.h"

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

bool store_prune(int64_t now_epoch) {
  int64_t newest = now_epoch > 0 ? now_epoch : 0;
  for (uint16_t i = 0; i < count; i++) {
    if (items[i].demo) continue;
    int64_t at = 0;
    if (parse_iso_epoch(items[i].at, &at) && at > newest) newest = at;
  }
  const int64_t cutoff = newest > 0 ? newest - (int64_t)NOTICE_KEEP_SEC : 0;
  uint16_t w = 0;
  bool changed = false;
  for (uint16_t i = 0; i < count; i++) {
    int64_t at = 0;
    bool keep = !items[i].demo && parse_iso_epoch(items[i].at, &at) && newest > 0 && at >= cutoff;
    if (!keep) {
      changed = true;
      continue;
    }
    if (w != i) items[w] = items[i];
    w++;
  }
  if (!changed) return false;
  count = w;
  persist();
  return true;
}

bool store_begin() {
  fs_ok = LittleFS.begin(true, "/littlefs", 10, "spiffs");
  if (fs_ok) load();
  store_prune(0);
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
