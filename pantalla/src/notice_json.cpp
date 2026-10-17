#include "notice.h"

#include "textutil.h"

#include <ArduinoJson.h>
#include <stdio.h>
#include <string.h>

static bool section_ok(const char *s) {
  return strcmp(s, "radar") == 0 || strcmp(s, "cartera") == 0 || strcmp(s, "reddit") == 0 ||
         strcmp(s, "ideas") == 0;
}

static void lower_ascii(char *s) {
  for (; *s; s++) {
    if (*s >= 'A' && *s <= 'Z') *s = (char)(*s - 'A' + 'a');
  }
}

bool notice_from_json(const char *line, NoticeDraft &out, char *err, size_t err_cap) {
  memset(&out, 0, sizeof out);
  if (err && err_cap) err[0] = 0;
  JsonDocument doc;
  DeserializationError e = deserializeJson(doc, line);
  if (e) {
    if (err && err_cap) snprintf(err, err_cap, "json");
    return false;
  }
  const char *section = doc["section"] | "";
  const char *title = doc["title"] | "";
  const char *message = doc["message"] | "";
  const char *at = doc["at"] | "";
  const char *id = doc["id"] | "";
  utf8_copy_chars(out.section, sizeof out.section, section, sizeof out.section - 1);
  lower_ascii(out.section);
  if (!section_ok(out.section)) {
    if (err && err_cap) snprintf(err, err_cap, "seccion");
    return false;
  }
  if (!title[0]) {
    if (err && err_cap) snprintf(err, err_cap, "titulo");
    return false;
  }
  utf8_copy_chars(out.id, sizeof out.id, id, sizeof out.id - 1);
  utf8_copy_chars(out.title, sizeof out.title, title, TITLE_CHARS);
  utf8_copy_chars(out.message, sizeof out.message, message, MESSAGE_CHARS);
  utf8_copy_chars(out.at, sizeof out.at, at, sizeof out.at - 1);
  return true;
}
