#include "line_asm.h"

#include <string.h>

void line_asm_reset(LineAsm &a) {
  a.len = 0;
  a.dropping = false;
}

static bool json_balanced(const char *s, size_t n) {
  int depth = 0;
  bool in_str = false;
  bool esc = false;
  bool seen = false;
  for (size_t i = 0; i < n; i++) {
    char c = s[i];
    if (in_str) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c == '\\') {
        esc = true;
        continue;
      }
      if (c == '"') in_str = false;
      continue;
    }
    if (c == '"') {
      in_str = true;
      continue;
    }
    if (c == '{') {
      depth++;
      seen = true;
      continue;
    }
    if (c == '}') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return seen && depth == 0 && !in_str && n > 0 && s[n - 1] == '}';
}

bool line_asm_push(LineAsm &a, const uint8_t *data, size_t n, size_t &used, char *out, size_t out_cap) {
  used = 0;
  if (out_cap == 0) return false;
  for (size_t i = 0; i < n; i++) {
    used++;
    unsigned char c = data[i];
    if (a.dropping) {
      if (c == '\n') a.dropping = false;
      continue;
    }
    if (c == '\r') continue;
    if (c == '\n') {
      if (a.len == 0) continue;
      size_t copy = a.len;
      if (copy >= out_cap) copy = out_cap - 1;
      memcpy(out, a.buf, copy);
      out[copy] = 0;
      a.len = 0;
      return true;
    }
    if (a.len + 1 >= LINE_ASM_CAP) {
      a.len = 0;
      a.dropping = true;
      continue;
    }
    a.buf[a.len++] = (char)c;
    if (c == '}' && json_balanced(a.buf, a.len)) {
      size_t copy = a.len;
      if (copy >= out_cap) copy = out_cap - 1;
      memcpy(out, a.buf, copy);
      out[copy] = 0;
      a.len = 0;
      return true;
    }
  }
  return false;
}
