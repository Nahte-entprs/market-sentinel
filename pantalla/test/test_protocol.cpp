#include "line_asm.h"
#include "notice.h"
#include "textutil.h"

#include <stdio.h>
#include <string.h>

static int fails = 0;

static void expect(bool cond, const char *name) {
  if (cond) {
    printf("ok  %s\n", name);
    return;
  }
  printf("FAIL %s\n", name);
  fails++;
}

static int push_all(LineAsm &a, const char *bytes, char lines[][LINE_ASM_CAP], int max_lines) {
  const uint8_t *data = (const uint8_t *)bytes;
  size_t n = strlen(bytes);
  size_t off = 0;
  int count = 0;
  while (off < n && count < max_lines) {
    size_t used = 0;
    bool got = line_asm_push(a, data + off, n - off, used, lines[count], LINE_ASM_CAP);
    if (used == 0) break;
    off += used;
    if (got) count++;
    if (!got) break;
  }
  return count;
}

int main() {
  char dst[8];
  utf8_copy_chars(dst, sizeof dst, "áéíóúñ", 3);
  expect(strcmp(dst, "áéí") == 0, "utf8 corta en punto de codigo");

  char hm[8];
  expect(format_hhmm("2026-10-09T22:03:00.000Z", -180, hm) && strcmp(hm, "19:03") == 0, "utc a santiago");
  expect(format_hhmm("2026-10-09T01:30:00Z", -180, hm) && strcmp(hm, "22:30") == 0, "cruza medianoche");
  expect(format_hhmm("2026-10-09T19:03:00-03:00", -180, hm) && strcmp(hm, "19:03") == 0, "offset ya local");
  expect(format_hhmm("2026-10-09T19:05:00", -180, hm) && strcmp(hm, "19:05") == 0, "sin zona se muestra tal cual");

  LineAsm a;
  line_asm_reset(a);
  char lines[4][LINE_ASM_CAP];
  const char *split1 = "{\"section\":\"radar\",\"title\":\"Ho";
  const char *split2 = "la\",\"message\":\"m\",\"at\":\"2026-10-09T22:03:00Z\"}\n";
  int n = push_all(a, split1, lines, 4);
  expect(n == 0, "trozo incompleto no cierra");
  n = push_all(a, split2, lines, 4);
  expect(n == 1, "el segundo trozo cierra el json");

  NoticeDraft d;
  char err[32];
  expect(notice_from_json(lines[0], d, err, sizeof err), "parse del aviso partido");
  expect(strcmp(d.section, "radar") == 0, "seccion radar");
  expect(strcmp(d.title, "Hola") == 0, "titulo reensamblado");
  expect(format_hhmm(d.at, -180, hm) && strcmp(hm, "19:03") == 0, "hora del aviso");

  line_asm_reset(a);
  const char *brace = "{\"title\":\"a}b\",\"section\":\"cartera\",\"message\":\"x\",\"at\":\"2026-10-09T19:00:00-03:00\"}";
  n = push_all(a, brace, lines, 4);
  expect(n == 1, "llave dentro del texto no corta");
  expect(notice_from_json(lines[0], d, err, sizeof err), "parse con llave en el titulo");
  expect(strcmp(d.title, "a}b") == 0, "titulo conserva la llave");
  expect(strcmp(d.section, "cartera") == 0, "seccion cartera");

  line_asm_reset(a);
  const char *two =
      "{\"section\":\"ideas\",\"title\":\"Uno\",\"message\":\"\",\"at\":\"2026-10-09T19:01:00-03:00\"}\n"
      "{\"section\":\"reddit\",\"title\":\"Dos\",\"message\":\"\",\"at\":\"2026-10-09T19:02:00-03:00\"}\n";
  n = push_all(a, two, lines, 4);
  expect(n == 2, "dos lineas");
  expect(notice_from_json(lines[1], d, err, sizeof err) && strcmp(d.section, "reddit") == 0, "segunda seccion");

  expect(!notice_from_json("{\"section\":\"nope\",\"title\":\"x\"}", d, err, sizeof err), "seccion invalida");
  expect(!notice_from_json("{\"section\":\"radar\"}", d, err, sizeof err), "sin titulo");

  char long_title[200];
  memset(long_title, 'A', 199);
  long_title[199] = 0;
  char raw[384];
  snprintf(raw, sizeof raw, "{\"section\":\"radar\",\"title\":\"%s\",\"message\":\"m\"}", long_title);
  expect(notice_from_json(raw, d, err, sizeof err), "titulo largo entra");
  expect(strlen(d.title) == TITLE_CHARS, "titulo truncado a 80");

  if (fails) {
    printf("%d fallos\n", fails);
    return 1;
  }
  printf("protocolo ok\n");
  return 0;
}
