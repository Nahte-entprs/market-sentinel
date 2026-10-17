#pragma once

// 1 = cotización aplicada, 0 = no es una cotización, -1 = línea inválida.
int tape_apply(const char *line);

struct TapeRow {
  char symbol[12];
  char price[16];
  char change[12];
  char volume[12];
};

int tape_count();
const TapeRow *tape_at(int index);
