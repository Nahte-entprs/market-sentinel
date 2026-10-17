#pragma once

#include "config.h"

#include <stddef.h>
#include <stdint.h>

// Reensambla escrituras BLE partidas en una linea JSON.
// Tambien cierra el objeto cuando las llaves cuadran, por si nRF Connect
// no manda el salto de linea.

struct LineAsm {
  char buf[LINE_ASM_CAP];
  size_t len = 0;
  bool dropping = false;
};

void line_asm_reset(LineAsm &a);

// Devuelve true y escribe una linea en out cuando hay un JSON completo.
// used es cuantos bytes de este trozo se consumieron. Llamar en bucle.
bool line_asm_push(LineAsm &a, const uint8_t *data, size_t n, size_t &used, char *out, size_t out_cap);
