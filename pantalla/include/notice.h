#pragma once

#include "config.h"

#include <stddef.h>
#include <stdint.h>

struct NoticeDraft {
  char id[24];
  char section[12];
  char title[192];
  char message[402];
  char at[40];
};

struct Notice {
  uint32_t id;
  char ext_id[24];
  char section[12];
  char title[192];
  char message[402];
  char at[40];
  uint8_t unread;
  uint8_t demo;
};

// err recibe un motivo corto si devuelve false.
bool notice_from_json(const char *line, NoticeDraft &out, char *err, size_t err_cap);
