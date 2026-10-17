#include "textutil.h"

#include <stdio.h>
#include <string.h>

size_t utf8_copy_chars(char *dst, size_t dst_cap, const char *src, size_t max_chars) {
  if (dst_cap == 0) return 0;
  size_t di = 0;
  size_t chars = 0;
  const unsigned char *s = (const unsigned char *)(src ? src : "");
  while (*s && chars < max_chars) {
    size_t need = 1;
    if ((*s & 0x80) == 0) need = 1;
    else if ((*s & 0xE0) == 0xC0) need = 2;
    else if ((*s & 0xF0) == 0xE0) need = 3;
    else if ((*s & 0xF8) == 0xF0) need = 4;
    else {
      s++;
      continue;
    }
    if (di + need >= dst_cap) break;
    bool ok = true;
    for (size_t k = 1; k < need; k++) {
      if ((s[k] & 0xC0) != 0x80) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      s++;
      continue;
    }
    for (size_t k = 0; k < need; k++) dst[di++] = (char)s[k];
    s += need;
    chars++;
  }
  dst[di] = 0;
  return chars;
}

static bool read_n(const char *s, int n, int *out) {
  int v = 0;
  for (int i = 0; i < n; i++) {
    if (s[i] < '0' || s[i] > '9') return false;
    v = v * 10 + (s[i] - '0');
  }
  *out = v;
  return true;
}

bool format_hhmm(const char *iso, int tz_offset_min, char out[8]) {
  if (!iso || !out) return false;
  const char *t = strchr(iso, 'T');
  if (!t) return false;
  int hh = 0;
  int mm = 0;
  if (!read_n(t + 1, 2, &hh) || t[3] != ':' || !read_n(t + 4, 2, &mm)) return false;
  if (hh > 23 || mm > 59) return false;

  int src_off = tz_offset_min;
  const char *p = t + 6;
  if (*p == ':') {
    p++;
    while (*p >= '0' && *p <= '9') p++;
    if (*p == '.') {
      p++;
      while (*p >= '0' && *p <= '9') p++;
    }
  }
  if (*p == 'Z') {
    src_off = 0;
  } else if (*p == '+' || *p == '-') {
    int sign = (*p == '+') ? 1 : -1;
    int oh = 0;
    int om = 0;
    if (p[3] != ':' || !read_n(p + 1, 2, &oh) || !read_n(p + 4, 2, &om)) return false;
    src_off = sign * (oh * 60 + om);
  }

  int total = hh * 60 + mm + (tz_offset_min - src_off);
  total %= 24 * 60;
  if (total < 0) total += 24 * 60;
  snprintf(out, 8, "%02d:%02d", total / 60, total % 60);
  return true;
}
