#pragma once

#include <stdint.h>

// 1 = cotización aplicada, 0 = no es una cotización, -1 = línea inválida.
int tape_apply(const char *line);

static constexpr int TAPE_SLOTS = 96;

struct TapeRow {
  char symbol[12];
  char price[16];
  char change[12];
  char volume[12];
  int32_t t0;
  int32_t t1;
  float level;
  uint8_t n;
  uint8_t slot[TAPE_SLOTS];
  float px[TAPE_SLOTS];
  float vl[TAPE_SLOTS];
};

int tape_count();
const TapeRow *tape_at(int index);
