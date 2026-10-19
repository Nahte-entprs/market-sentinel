#pragma once

#include <stdint.h>

// 1 = cotización aplicada, 0 = no es una cotización, -1 = línea inválida.
int tape_apply(const char *line);

static constexpr int TAPE_CURVE_CAP = 48;

struct TapeRow {
  char symbol[12];
  char price[16];
  char change[12];
  char volume[12];
  uint8_t n;
  float px[TAPE_CURVE_CAP];
  float vl[TAPE_CURVE_CAP];
};

int tape_count();
const TapeRow *tape_at(int index);
