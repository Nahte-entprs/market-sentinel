#pragma once

#include <stddef.h>
#include <stdint.h>

// Copia como mucho max_chars puntos de codigo UTF-8, sin cortar un caracter.
size_t utf8_copy_chars(char *dst, size_t dst_cap, const char *src, size_t max_chars);

// "HH:MM" en la zona tz_offset_min. Z y +00:00 se convierten; un offset
// explicito se respeta; sin zona se muestra la hora tal cual.
bool format_hhmm(const char *iso, int tz_offset_min, char out[8]);

// Segundos UTC. Acepta fracción de segundo y zona Z, +HH:MM o -HH:MM.
bool parse_iso_epoch(const char *iso, int64_t *out);
