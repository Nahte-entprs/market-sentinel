#include "ui.h"

#include "battery.h"
#include "config.h"
#include "store.h"
#include "tape.h"
#include "textutil.h"

#include <Preferences.h>
#include <lvgl.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

LV_FONT_DECLARE(font_latin_14)
LV_FONT_DECLARE(font_latin_16)
LV_FONT_DECLARE(font_latin_18)

static const char *FILTERS[] = {"Notificaciones", "En vivo"};
static const char *FILTER_ID[] = {"", "live"};

static lv_obj_t *heart = nullptr;
static lv_obj_t *battery = nullptr;
static lv_obj_t *stale_box = nullptr;
static lv_obj_t *clock_label = nullptr;
static lv_obj_t *filter_btns[2] = {};
static lv_obj_t *batt_fill = nullptr;
static lv_obj_t *batt_mark = nullptr;
static lv_obj_t *drawer = nullptr;
static lv_obj_t *catcher = nullptr;
static lv_obj_t *spin_box = nullptr;
static lv_obj_t *spin_value = nullptr;
static lv_obj_t *list = nullptr;
static lv_obj_t *detail = nullptr;
static lv_obj_t *d_section = nullptr;
static lv_obj_t *d_time = nullptr;
static lv_obj_t *d_title = nullptr;
static lv_obj_t *d_message = nullptr;
static int filter = 0;
static bool link_on = false;
static bool dirty = true;

static lv_color_t section_color(const char *section) {
  if (strcmp(section, "cartera") == 0) return lv_color_hex(0x3DDC97);
  if (strcmp(section, "reddit") == 0) return lv_color_hex(0xFF6B3D);
  if (strcmp(section, "ideas") == 0) return lv_color_hex(0x7AA2FF);
  return lv_color_hex(0xE0A100);
}

static const char *section_name(const char *section) {
  if (strcmp(section, "cartera") == 0) return "Cartera";
  if (strcmp(section, "reddit") == 0) return "Reddit";
  if (strcmp(section, "ideas") == 0) return "Ideas";
  return "Radar";
}

static lv_coord_t scale_point(float v, float lo, float hi) {
  if (!(hi > lo)) return 500;
  float t = (v - lo) / (hi - lo);
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return (lv_coord_t)(t * 1000.0f);
}

static void style_chart(lv_obj_t *chart) {
  lv_obj_set_style_bg_opa(chart, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(chart, 0, 0);
  lv_obj_set_style_pad_all(chart, 0, 0);
  lv_obj_set_style_size(chart, 0, LV_PART_INDICATOR);
  lv_obj_set_style_line_width(chart, 2, LV_PART_ITEMS);
  lv_chart_set_div_line_count(chart, 5, 0);
  lv_obj_set_style_line_color(chart, lv_color_hex(0x5C6554), LV_PART_MAIN);
  lv_obj_set_style_line_opa(chart, LV_OPA_50, LV_PART_MAIN);
  lv_obj_set_style_line_width(chart, 1, LV_PART_MAIN);
  lv_chart_set_axis_tick(chart, LV_CHART_AXIS_PRIMARY_Y, 0, 0, 0, 0, false, 0);
  lv_chart_set_axis_tick(chart, LV_CHART_AXIS_PRIMARY_X, 0, 0, 0, 0, false, 0);
}

static int32_t axis_t0 = 0;
static int32_t axis_t1 = 0;
static float vol_slot[TAPE_SLOTS];
static float avg_slot[TAPE_SLOTS];
static float vol_max = 0;
static float px_slot[TAPE_SLOTS];
static uint8_t px_on[TAPE_SLOTS];
static float plot_lo = 0;
static float plot_hi = 1;
static int ball_slot = -1;
static int slot_span = TAPE_SLOTS - 1;
static int slot_origin = 0;
static int mark_sec = 1800;
static int span_i = 0;
static const int SPAN_SEC[] = {7 * 3600, 4 * 3600, 2 * 3600, 3600, 1800};
static const int SPAN_MARK[] = {1800, 1800, 900, 300, 150};
static const char *SPAN_NAME[] = {"7 h", "4 h", "2 h", "1 h", "30 m"};
static bool drawer_open = false;
static uint32_t drawer_ms = 0;
static bool auto_spin = false;
static int spin_sec = 15;
static uint32_t spin_ms = 0;
static bool spin_hold = false;
static bool ignore_check_click = false;
static char pinned[12] = "";
static int batt_pct = 0;
static int batt_state = 0;
static uint32_t batt_ms = 0;
static lv_color_t ball_ink = lv_color_hex(0xF2F0E6);
static lv_obj_t *ball = nullptr;
static uint32_t last_quote_ms = 0;
static lv_obj_t *cap_label = nullptr;
static lv_obj_t *vol_label = nullptr;
static lv_obj_t *scale_label = nullptr;

static const int PLOT_INSET = 10;

static int inner_x(int origin, int width, int slot) {
  int rel = slot - slot_origin;
  int denom = slot_span - slot_origin;
  if (denom < 1) denom = 1;
  if (rel < 0) rel = 0;
  if (rel > denom) rel = denom;
  int inner = width - PLOT_INSET * 2;
  if (inner < 8) return origin + (int)((int32_t)width * rel) / denom;
  return origin + PLOT_INSET + (int)((int32_t)inner * rel) / denom;
}

static void format_clock(int32_t unix_sec, char *out, size_t n, bool seconds) {
  int64_t local = (int64_t)unix_sec + (int64_t)TZ_OFFSET_MIN * 60;
  int sod = (int)(local % 86400);
  if (sod < 0) sod += 86400;
  int hh = sod / 3600;
  int mm = (sod % 3600) / 60;
  int ss = sod % 60;
  if (seconds) snprintf(out, n, "%d:%02d:%02d", hh, mm, ss);
  else snprintf(out, n, "%d:%02d", hh, mm);
}

static float axis_step(float max_abs_pct) {
  static const float steps[] = {1.f, 2.f, 3.f, 5.f, 10.f, 25.f, 50.f};
  for (float step : steps) {
    if (max_abs_pct <= step) return step;
  }
  float step = 50.f;
  while (step < max_abs_pct && step < 10000.f) step *= 2.f;
  return step;
}

static void format_step(char *out, size_t n, float step) {
  snprintf(out, n, "\xC2\xB1" "%.0f%%", step);
}

static int64_t display_mark(int64_t mark) {
  if (span_i != 4) return mark;
  int sec = (int)((mark % 60) + 60) % 60;
  if (sec == 30) return mark + 30;
  return mark;
}

static void put_px(lv_draw_ctx_t *ctx, int x, int y, lv_color_t color, uint8_t opa) {
  if (opa < 12) return;
  if (x < ctx->clip_area->x1 || x > ctx->clip_area->x2 || y < ctx->clip_area->y1 || y > ctx->clip_area->y2) return;
  if (x < ctx->buf_area->x1 || x > ctx->buf_area->x2 || y < ctx->buf_area->y1 || y > ctx->buf_area->y2) return;
  int stride = ctx->buf_area->x2 - ctx->buf_area->x1 + 1;
  lv_color_t *buf = (lv_color_t *)ctx->buf;
  int i = (y - ctx->buf_area->y1) * stride + (x - ctx->buf_area->x1);
  buf[i] = opa > 240 ? color : lv_color_mix(color, buf[i], opa);
}

static int text_px_width(const lv_font_t *font, const char *text) {
  int width = 0;
  for (const char *p = text; *p; p++) {
    lv_font_glyph_dsc_t gd;
    uint32_t next = p[1] ? (uint32_t)(uint8_t)p[1] : 0;
    if (!lv_font_get_glyph_dsc(font, &gd, (uint32_t)(uint8_t)*p, next)) continue;
    width += gd.adv_w;
  }
  return width;
}

static void draw_sideways(lv_draw_ctx_t *ctx, const char *text, int mark_x, int top_y, lv_color_t color) {
  const lv_font_t *font = &lv_font_montserrat_12;
  int str_w = text_px_width(font, text);
  if (str_w < 4) return;
  int line_h = lv_font_get_line_height(font);
  int left = mark_x - line_h / 2;
  int baseline = line_h - font->base_line;
  int pen = 0;
  static const uint8_t shade[16] = {0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255};
  for (const char *p = text; *p; p++) {
    lv_font_glyph_dsc_t gd;
    uint32_t letter = (uint32_t)(uint8_t)*p;
    uint32_t next = p[1] ? (uint32_t)(uint8_t)p[1] : 0;
    if (!lv_font_get_glyph_dsc(font, &gd, letter, next)) continue;
    const uint8_t *map = lv_font_get_glyph_bitmap(font, letter);
    if (map && gd.box_w > 0 && gd.box_h > 0 && gd.bpp == 4) {
      int origin_x = pen + gd.ofs_x;
      int origin_y = baseline - gd.box_h - gd.ofs_y;
      for (int row = 0; row < gd.box_h; row++) {
        for (int col = 0; col < gd.box_w; col++) {
          int bit = (row * gd.box_w + col) * 4;
          uint8_t px = (map[bit >> 3] >> (4 - (bit & 4))) & 0x0F;
          if (!px) continue;
          int sx = origin_x + col;
          int sy = origin_y + row;
          put_px(ctx, left + (line_h - 1 - sy), top_y + sx, color, shade[px]);
        }
      }
    }
    pen += gd.adv_w;
  }
}

static void draw_times(lv_draw_ctx_t *ctx, const lv_obj_t *chart, int x_ofs, int w) {
  if (axis_t1 <= axis_t0 || w < 40) return;
  int64_t local0 = (int64_t)axis_t0 + (int64_t)TZ_OFFSET_MIN * 60;
  int64_t local1 = (int64_t)axis_t1 + (int64_t)TZ_OFFSET_MIN * 60;
  int64_t span = local1 - local0;
  if (span <= 0) return;
  int top = (int)chart->coords.y1 + 1;
  int inner = w - PLOT_INSET * 2;
  if (inner < 8) inner = w;
  int live_x = (int)x_ofs + PLOT_INSET + inner;
  int step = mark_sec > 0 ? mark_sec : 1800;
  int64_t rem = ((local0 % step) + step) % step;
  for (int64_t mark = rem == 0 ? local0 : local0 + (step - rem); mark < local1; mark += step) {
    if (mark <= local0 || mark >= local1) continue;
    int x = (int)x_ofs + PLOT_INSET + (int)((mark - local0) * inner / span);
    if (x < (int)x_ofs + PLOT_INSET || x >= live_x - 18) continue;
    char text[8];
    int64_t shown = display_mark(mark);
    format_clock((int32_t)(shown - (int64_t)TZ_OFFSET_MIN * 60), text, sizeof text, false);
    draw_sideways(ctx, text, x, top, lv_color_hex(0xC5CBB8));
  }
  char now[12];
  format_clock(axis_t1, now, sizeof now, true);
  draw_sideways(ctx, now, live_x - 8, top, lv_color_hex(0xF2F0E6));
}

static void chart_plot(lv_obj_t *obj, lv_coord_t *x_ofs, lv_coord_t *y_ofs, lv_coord_t *w, lv_coord_t *h) {
  lv_coord_t border = lv_obj_get_style_border_width(obj, LV_PART_MAIN);
  lv_coord_t pad_left = lv_obj_get_style_pad_left(obj, LV_PART_MAIN) + border;
  lv_coord_t pad_top = lv_obj_get_style_pad_top(obj, LV_PART_MAIN) + border;
  *w = lv_obj_get_content_width(obj);
  *h = lv_obj_get_content_height(obj);
  *x_ofs = obj->coords.x1 + pad_left;
  *y_ofs = obj->coords.y1 + pad_top;
}

static void on_chart_size(lv_event_t *e) {
  if (!cap_label || !vol_label) return;
  lv_obj_t *chart = lv_event_get_target(e);
  if (lv_obj_get_parent(cap_label) != chart) return;
  lv_coord_t hh = lv_obj_get_height(chart);
  if (hh < 40) return;
  lv_obj_update_layout(cap_label);
  lv_coord_t cw = lv_obj_get_width(cap_label);
  lv_coord_t ch = lv_obj_get_height(cap_label);
  if (cw < 8 || ch < 8) return;
  lv_obj_set_pos(cap_label, ch / 2 - cw / 2, hh / 2 - ch / 2);
  lv_obj_update_layout(vol_label);
  lv_coord_t nh = lv_obj_get_height(vol_label);
  lv_coord_t y = hh / 2 + cw / 2 - nh;
  if (y < 0) y = 0;
  if (y > hh - nh) y = hh - nh;
  lv_obj_set_pos(vol_label, ch + 4, y);
  if (scale_label && lv_obj_get_parent(scale_label) == chart) {
    lv_obj_update_layout(scale_label);
    lv_coord_t sw = lv_obj_get_width(scale_label);
    lv_coord_t plot_w = lv_obj_get_content_width(chart);
    lv_obj_set_pos(scale_label, plot_w - sw - PLOT_INSET, 18);
  }
  if (ball && ball_slot >= 0 && lv_obj_get_parent(ball) == chart && plot_hi > plot_lo) {
    lv_coord_t x_ofs, y_ofs, w, h;
    chart_plot(chart, &x_ofs, &y_ofs, &w, &h);
    int x = inner_x(0, (int)w, ball_slot);
    float t = (px_slot[ball_slot] - plot_lo) / (plot_hi - plot_lo);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    int y = (int)h - (int)(t * (float)h);
    lv_obj_set_pos(ball, x - 5, y - 5);
  }
}

static int days_from_civil(int y, unsigned m, unsigned d) {
  y -= m <= 2;
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (int)doe - 719468;
}

static void civil_from_days(int z, int *y, int *m, int *d) {
  z += 719468;
  const int era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = (unsigned)(z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const int yy = (int)yoe + era * 400;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  const unsigned dd = doy - (153 * mp + 2) / 5 + 1;
  const unsigned mm = mp + (mp < 10 ? 3 : -9);
  *y = yy + (mm <= 2);
  *m = (int)mm;
  *d = (int)dd;
}

static void unix_parts(int32_t unix_sec, int off_min, int *Y, int *M, int *D, int *sod) {
  int64_t local = (int64_t)unix_sec + (int64_t)off_min * 60;
  int s = (int)((local % 86400 + 86400) % 86400);
  int64_t days = (local - s) / 86400;
  civil_from_days((int)days, Y, M, D);
  *sod = s;
}

static int nth_sunday(int y, int month, int n) {
  int t = days_from_civil(y, (unsigned)month, 1);
  int wd = (t + 4) % 7;
  if (wd < 0) wd += 7;
  return 1 + (7 - wd) % 7 + (n - 1) * 7;
}

static bool us_dst(int y, int m, int d, int sod) {
  int start = nth_sunday(y, 3, 2);
  int end = nth_sunday(y, 11, 1);
  if (m < 3 || m > 11) return false;
  if (m > 3 && m < 11) return true;
  if (m == 3) return d > start || (d == start && sod >= 2 * 3600);
  return d < end || (d == end && sod < 2 * 3600);
}

static int eastern_off(int32_t unix_sec) {
  int Y, M, D, sod;
  unix_parts(unix_sec, -300, &Y, &M, &D, &sod);
  if (!us_dst(Y, M, D, sod)) return -300;
  unix_parts(unix_sec, -240, &Y, &M, &D, &sod);
  return us_dst(Y, M, D, sod) ? -240 : -300;
}

static void draw_sessions(lv_draw_ctx_t *ctx, int x_ofs, int y_ofs, int w, int h) {
  if (axis_t1 <= axis_t0) return;
  int off = eastern_off(axis_t1);
  int Y, M, D, sod;
  unix_parts(axis_t1, off, &Y, &M, &D, &sod);
  int day = days_from_civil(Y, (unsigned)M, (unsigned)D);
  const int hm[4][2] = {{4, 0}, {9, 30}, {16, 0}, {20, 0}};
  const uint32_t col[4] = {0x6EC8FF, 0x3DDC97, 0xFF5A6A, 0xE0A100};
  int inner = w - PLOT_INSET * 2;
  if (inner < 8) inner = w;
  int32_t span = axis_t1 - axis_t0;
  if (span <= 0) return;
  for (int d = day - 1; d <= day; d++) {
    int y, m, dd;
    civil_from_days(d, &y, &m, &dd);
    for (int k = 0; k < 4; k++) {
      int sod_m = hm[k][0] * 3600 + hm[k][1] * 60;
      int32_t guess = (int32_t)((int64_t)days_from_civil(y, (unsigned)m, (unsigned)dd) * 86400 + sod_m + 300 * 60);
      int mark_off = eastern_off(guess);
      int32_t utc = (int32_t)((int64_t)days_from_civil(y, (unsigned)m, (unsigned)dd) * 86400 + sod_m - (int64_t)mark_off * 60);
      if (utc <= axis_t0 || utc >= axis_t1) continue;
      int x = x_ofs + PLOT_INSET + (int)((int64_t)(utc - axis_t0) * inner / span);
      lv_draw_line_dsc_t line;
      lv_draw_line_dsc_init(&line);
      line.color = lv_color_hex(col[k]);
      line.width = 3;
      line.opa = LV_OPA_COVER;
      lv_point_t p1 = {(lv_coord_t)x, (lv_coord_t)(y_ofs + 1)};
      lv_point_t p2 = {(lv_coord_t)x, (lv_coord_t)(y_ofs + h - 1)};
      lv_draw_line(ctx, &line, &p1, &p2);
    }
  }
}

static void on_chart_draw(lv_event_t *e) {
  lv_obj_t *obj = lv_event_get_target(e);
  lv_draw_ctx_t *ctx = lv_event_get_draw_ctx(e);
  if (!ctx) return;
  lv_coord_t x_ofs, y_ofs, w, h;
  chart_plot(obj, &x_ofs, &y_ofs, &w, &h);
  if (w < 8 || h < 8) return;
  lv_event_code_t code = lv_event_get_code(e);

  if (code == LV_EVENT_DRAW_MAIN) {
    int band = (int)h * 32 / 100;
    if (band < 10) band = 10;
    int base = (int)y_ofs + (int)h - 1;
    if (vol_max > 0) {
      lv_draw_line_dsc_t avg;
      lv_draw_line_dsc_init(&avg);
      avg.color = lv_color_hex(0x7AA2FF);
      avg.width = 2;
      avg.opa = LV_OPA_80;
      int prev = -1;
      for (int i = 0; i < TAPE_SLOTS; i++) {
        if (i < slot_origin) continue;
        if (!(avg_slot[i] > 0)) {
          prev = -1;
          continue;
        }
        int x = inner_x((int)x_ofs, (int)w, i);
        int bh = (int)(avg_slot[i] / vol_max * band);
        if (bh < 1) bh = 1;
        int y = base - bh;
        if (prev >= 0) {
          int px0 = inner_x((int)x_ofs, (int)w, prev);
          int ph = (int)(avg_slot[prev] / vol_max * band);
          if (ph < 1) ph = 1;
          lv_point_t a = {(lv_coord_t)px0, (lv_coord_t)(base - ph)};
          lv_point_t b = {(lv_coord_t)x, (lv_coord_t)y};
          lv_draw_line(ctx, &avg, &a, &b);
        }
        prev = i;
      }
      int vis = slot_span - slot_origin + 1;
      if (vis < 1) vis = 1;
      int bw = (int)w / vis;
      if (bw < 2) bw = 2;
      if (bw > 4) bw = 4;
      lv_draw_rect_dsc_t rd;
      lv_draw_rect_dsc_init(&rd);
      rd.bg_color = lv_color_hex(0xE0A100);
      rd.bg_opa = LV_OPA_70;
      rd.border_width = 0;
      for (int i = 0; i < TAPE_SLOTS; i++) {
        if (i < slot_origin) continue;
        if (!(vol_slot[i] > 0)) continue;
        int bh = (int)(vol_slot[i] / vol_max * band);
        if (bh < 1) bh = 1;
        int x = inner_x((int)x_ofs, (int)w, i);
        lv_area_t box;
        box.x1 = (lv_coord_t)(x - bw / 2);
        box.x2 = (lv_coord_t)(box.x1 + bw - 1);
        box.y2 = (lv_coord_t)base;
        box.y1 = (lv_coord_t)(base - bh);
        lv_draw_rect(ctx, &rd, &box);
      }
    }
    return;
  }

  if (axis_t1 <= axis_t0) return;
  int64_t local0 = (int64_t)axis_t0 + (int64_t)TZ_OFFSET_MIN * 60;
  int64_t local1 = (int64_t)axis_t1 + (int64_t)TZ_OFFSET_MIN * 60;
  int64_t span = local1 - local0;
  if (span <= 0) return;
  int step = mark_sec > 0 ? mark_sec : 1800;
  int64_t rem = ((local0 % step) + step) % step;
  int64_t mark = rem == 0 ? local0 : local0 + (step - rem);
  lv_draw_line_dsc_t dsc;
  lv_draw_line_dsc_init(&dsc);
  dsc.color = lv_color_hex(0xC6A15B);
  dsc.width = 1;
  dsc.opa = LV_OPA_30;
  int inner = (int)w - PLOT_INSET * 2;
  if (inner < 8) inner = (int)w;
  for (; mark < local1; mark += step) {
    if (mark <= local0 || mark >= local1) continue;
    int x = (int)x_ofs + PLOT_INSET + (int)((mark - local0) * inner / span);
    if (x <= (int)x_ofs + PLOT_INSET || x >= (int)x_ofs + (int)w - PLOT_INSET) continue;
    lv_point_t p1 = {(lv_coord_t)x, (lv_coord_t)(y_ofs + 1)};
    lv_point_t p2 = {(lv_coord_t)x, (lv_coord_t)(y_ofs + h - 1)};
    lv_draw_line(ctx, &dsc, &p1, &p2);
  }
  draw_times(ctx, obj, (int)x_ofs, (int)w);
  if (plot_hi > plot_lo) {
    lv_draw_line_dsc_t price;
    lv_draw_line_dsc_init(&price);
    price.width = 2;
    price.opa = LV_OPA_COVER;
    int prev = -1;
    int dir = 0;
    auto y_of = [&](float v) -> int {
      float t = (v - plot_lo) / (plot_hi - plot_lo);
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      return (int)y_ofs + (int)h - (int)(t * (float)h);
    };
    for (int i = 0; i < TAPE_SLOTS; i++) {
      if (i < slot_origin) continue;
      if (!px_on[i]) {
        prev = -1;
        continue;
      }
      if (prev >= 0) {
        float a = px_slot[prev];
        float b = px_slot[i];
        if (b > a + 0.001f) dir = 1;
        else if (b < a - 0.001f) dir = -1;
        if (i == prev + 1) {
          price.color = dir > 0 ? lv_color_hex(0x3DDC97) : dir < 0 ? lv_color_hex(0xFF6B6B) : lv_color_hex(0xF2F0E6);
          lv_point_t p1 = {(lv_coord_t)inner_x((int)x_ofs, (int)w, prev), (lv_coord_t)y_of(a)};
          lv_point_t p2 = {(lv_coord_t)inner_x((int)x_ofs, (int)w, i), (lv_coord_t)y_of(b)};
          lv_draw_line(ctx, &price, &p1, &p2);
        }
      }
      prev = i;
    }
  }
  draw_sessions(ctx, (int)x_ofs, (int)y_ofs, (int)w, (int)h);
}

static int tape_index() {
  int n = tape_count();
  if (n <= 0) return 0;
  if (pinned[0]) {
    for (int i = 0; i < n; i++) {
      const TapeRow *row = tape_at(i);
      if (row && strcmp(row->symbol, pinned) == 0) return i;
    }
  }
  const TapeRow *row = tape_at(0);
  if (row) {
    strncpy(pinned, row->symbol, sizeof pinned - 1);
    pinned[sizeof pinned - 1] = 0;
  }
  return 0;
}

static void pin_step(int dir) {
  int n = tape_count();
  if (n <= 0) return;
  int i = (tape_index() + dir) % n;
  if (i < 0) i += n;
  const TapeRow *row = tape_at(i);
  if (row) {
    strncpy(pinned, row->symbol, sizeof pinned - 1);
    pinned[sizeof pinned - 1] = 0;
  }
  spin_ms = lv_tick_get();
  dirty = true;
}

static void on_prev(lv_event_t *) { pin_step(-1); }
static void on_next(lv_event_t *) { pin_step(1); }

static void on_span(lv_event_t *) {
  span_i = (span_i + 1) % 5;
  dirty = true;
}

static void save_spin() {
  Preferences prefs;
  if (!prefs.begin("pantalla", false)) return;
  prefs.putInt("spin", spin_sec);
  prefs.end();
}

static void on_spin_delta(lv_event_t *e) {
  int delta = (int)(intptr_t)lv_event_get_user_data(e);
  spin_sec += delta;
  if (spin_sec < 5) spin_sec = 5;
  if (spin_sec > 180) spin_sec = 180;
  save_spin();
  if (spin_value) lv_label_set_text_fmt(spin_value, "%d s", spin_sec);
}

static void on_spin_close(lv_event_t *) {
  spin_hold = false;
  if (spin_box) lv_obj_add_flag(spin_box, LV_OBJ_FLAG_HIDDEN);
}

static void on_check(lv_event_t *e) {
  if (lv_event_get_code(e) == LV_EVENT_LONG_PRESSED) {
    ignore_check_click = true;
    spin_hold = true;
    if (spin_value) lv_label_set_text_fmt(spin_value, "%d s", spin_sec);
    if (spin_box) {
      lv_obj_clear_flag(spin_box, LV_OBJ_FLAG_HIDDEN);
      lv_obj_move_foreground(spin_box);
    }
    return;
  }
  if (ignore_check_click) {
    ignore_check_click = false;
    return;
  }
  auto_spin = !auto_spin;
  spin_ms = lv_tick_get();
  dirty = true;
}

static lv_color_t metric_color(const char *token) {
  if (strncmp(token, "RSI ", 4) == 0) {
    if (token[4] < '0' || token[4] > '9') return lv_color_hex(0xC5CBB8);
    float v = strtof(token + 4, nullptr);
    if (v >= 70.f || v <= 30.f) return lv_color_hex(0xE0A100);
    return lv_color_hex(0xC5CBB8);
  }
  const char *sp = strchr(token, ' ');
  if (sp && sp[1] == '+') return lv_color_hex(0x3DDC97);
  if (sp && sp[1] == '-') return lv_color_hex(0xFF6B6B);
  return lv_color_hex(0xC5CBB8);
}

static void paint_metrics(const char *packed, const char *fallback, int height) {
  const char *src = packed && packed[0] ? packed : fallback;
  char buf[96];
  strncpy(buf, src, sizeof buf - 1);
  buf[sizeof buf - 1] = 0;
  lv_obj_t *row = lv_obj_create(list);
  lv_obj_set_width(row, lv_pct(100));
  lv_obj_set_height(row, height);
  lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_side(row, LV_BORDER_SIDE_BOTTOM, 0);
  lv_obj_set_style_border_width(row, 1, 0);
  lv_obj_set_style_border_color(row, lv_color_hex(0x3C4436), 0);
  lv_obj_set_style_radius(row, 0, 0);
  lv_obj_set_style_pad_hor(row, 2, 0);
  lv_obj_set_style_pad_ver(row, 0, 0);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(row, LV_FLEX_ALIGN_SPACE_EVENLY, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_clear_flag(row, LV_OBJ_FLAG_SCROLLABLE);
  for (char *p = buf; p && *p;) {
    char *sep = strchr(p, ';');
    if (sep) *sep = 0;
    lv_obj_t *lb = lv_label_create(row);
    lv_label_set_text(lb, p);
    lv_obj_set_style_text_font(lb, &font_latin_14, 0);
    lv_obj_set_style_text_color(lb, metric_color(p), 0);
    if (!sep) break;
    p = sep + 1;
  }
}

static void paint_live(const TapeRow *q) {
  paint_metrics(q->macro, "SPX --;NDX --;CL --;10Y --;VIX --", 24);
  bool up = q->change[0] == '+';
  bool down = q->change[0] == '-';
  lv_color_t ink = up ? lv_color_hex(0x3DDC97) : down ? lv_color_hex(0xFF6B6B) : lv_color_hex(0xF2F0E6);

  lv_obj_t *head = lv_obj_create(list);
  lv_obj_set_width(head, lv_pct(100));
  lv_obj_set_height(head, 28);
  lv_obj_set_style_bg_opa(head, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(head, 0, 0);
  lv_obj_set_style_pad_all(head, 0, 0);
  lv_obj_set_flex_flow(head, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(head, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_clear_flag(head, LV_OBJ_FLAG_SCROLLABLE);

  lv_obj_t *left = lv_obj_create(head);
  lv_obj_set_size(left, LV_SIZE_CONTENT, 28);
  lv_obj_set_style_bg_opa(left, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(left, 0, 0);
  lv_obj_set_style_pad_all(left, 0, 0);
  lv_obj_set_style_pad_column(left, 8, 0);
  lv_obj_set_flex_flow(left, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(left, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_clear_flag(left, LV_OBJ_FLAG_SCROLLABLE);

  lv_obj_t *prev_btn = lv_btn_create(left);
  lv_obj_set_size(prev_btn, 22, 22);
  lv_obj_set_style_radius(prev_btn, 6, 0);
  lv_obj_set_style_bg_color(prev_btn, lv_color_hex(0x1C2118), 0);
  lv_obj_set_style_shadow_width(prev_btn, 0, 0);
  lv_obj_set_style_pad_all(prev_btn, 0, 0);
  lv_obj_add_event_cb(prev_btn, on_prev, LV_EVENT_CLICKED, nullptr);
  lv_obj_t *prev_lbl = lv_label_create(prev_btn);
  lv_label_set_text(prev_lbl, "<");
  lv_obj_set_style_text_font(prev_lbl, &font_latin_16, 0);
  lv_obj_center(prev_lbl);

  lv_obj_t *sym = lv_label_create(left);
  lv_label_set_text(sym, q->symbol);
  lv_obj_set_style_text_font(sym, &font_latin_18, 0);
  lv_obj_set_style_text_color(sym, ink, 0);

  char summary[48];
  snprintf(summary, sizeof summary, "%s  %s", q->price[0] ? q->price : "n/d", q->change[0] ? q->change : "—");
  lv_obj_t *px = lv_label_create(left);
  lv_label_set_text(px, summary);
  lv_obj_set_style_text_font(px, &font_latin_16, 0);
  lv_obj_set_style_text_color(px, ink, 0);

  lv_obj_t *next_btn = lv_btn_create(left);
  lv_obj_set_size(next_btn, 22, 22);
  lv_obj_set_style_radius(next_btn, 6, 0);
  lv_obj_set_style_bg_color(next_btn, lv_color_hex(0x1C2118), 0);
  lv_obj_set_style_shadow_width(next_btn, 0, 0);
  lv_obj_set_style_pad_all(next_btn, 0, 0);
  lv_obj_add_event_cb(next_btn, on_next, LV_EVENT_CLICKED, nullptr);
  lv_obj_t *next_lbl = lv_label_create(next_btn);
  lv_label_set_text(next_lbl, ">");
  lv_obj_set_style_text_font(next_lbl, &font_latin_16, 0);
  lv_obj_center(next_lbl);

  lv_obj_t *check = lv_btn_create(left);
  lv_obj_set_size(check, 18, 18);
  lv_obj_set_style_radius(check, 3, 0);
  lv_obj_set_style_bg_color(check, auto_spin ? lv_color_hex(0xC6A15B) : lv_color_hex(0x12140F), 0);
  lv_obj_set_style_border_width(check, 2, 0);
  lv_obj_set_style_border_color(check, lv_color_hex(0xC6A15B), 0);
  lv_obj_set_style_shadow_width(check, 0, 0);
  lv_obj_set_style_pad_all(check, 0, 0);
  lv_obj_add_event_cb(check, on_check, LV_EVENT_CLICKED, nullptr);
  lv_obj_add_event_cb(check, on_check, LV_EVENT_LONG_PRESSED, nullptr);

  lv_obj_t *span_btn = lv_btn_create(left);
  lv_obj_set_size(span_btn, 46, 22);
  lv_obj_set_style_radius(span_btn, 6, 0);
  lv_obj_set_style_bg_color(span_btn, lv_color_hex(0x1C2118), 0);
  lv_obj_set_style_shadow_width(span_btn, 0, 0);
  lv_obj_set_style_pad_all(span_btn, 0, 0);
  lv_obj_add_event_cb(span_btn, on_span, LV_EVENT_CLICKED, nullptr);
  lv_obj_t *span_lbl = lv_label_create(span_btn);
  lv_label_set_text(span_lbl, SPAN_NAME[span_i]);
  lv_obj_set_style_text_font(span_lbl, &font_latin_14, 0);
  lv_obj_set_style_text_color(span_lbl, lv_color_hex(0xF2F0E6), 0);
  lv_obj_center(span_lbl);

  if (q->level > 0) {
    float cur = 0;
    int best = -1;
    for (int i = 0; i < q->n; i++) {
      if ((int)q->slot[i] >= best) {
        best = q->slot[i];
        cur = q->px[i];
      }
    }
    float pct = q->level > 0 ? (cur - q->level) / q->level * 100.f : 0;
    char extra[40];
    snprintf(extra, sizeof extra, "%.2f  %+.2f%%", q->level, pct);
    lv_obj_t *nl = lv_label_create(head);
    lv_label_set_text(nl, extra);
    lv_obj_set_style_text_font(nl, &font_latin_14, 0);
    lv_obj_set_style_text_color(nl, lv_color_hex(0xD4A6FF), 0);
  }

  paint_metrics(q->signal, "RSI --;VWAP --;RVOL --", 22);

  if (q->n < 2) {
    lv_obj_t *empty = lv_label_create(list);
    lv_label_set_text_fmt(empty, "Sin curva todavía\nVolumen de la sesión  %s", q->volume[0] ? q->volume : "n/d");
    lv_obj_set_style_text_color(empty, lv_color_hex(0x9AA392), 0);
    return;
  }

  float raw_lo = q->px[0];
  float raw_hi = q->px[0];
  float vhi = 0;
  for (int i = 0; i < q->n; i++) {
    if (q->px[i] < raw_lo) raw_lo = q->px[i];
    if (q->px[i] > raw_hi) raw_hi = q->px[i];
    if (q->vl[i] > vhi) vhi = q->vl[i];
    if (q->va[i] > vhi) vhi = q->va[i];
  }
  float last = strtof(q->price, nullptr);
  float chg = strtof(q->change, nullptr);
  float base = (last > 0 && q->change[0]) ? last / (1.f + chg / 100.f) : (raw_lo + raw_hi) / 2.f;
  if (!(base > 0)) base = raw_lo > 0 ? raw_lo : 1.f;
  float max_abs = fabsf((raw_lo - base) / base * 100.f);
  float hi_abs = fabsf((raw_hi - base) / base * 100.f);
  if (hi_abs > max_abs) max_abs = hi_abs;
  float step = axis_step(max_abs);
  float plo = base * (1.f - step / 100.f);
  float phi = base * (1.f + step / 100.f);
  plot_lo = plo;
  plot_hi = phi;

  axis_t0 = q->t0;
  axis_t1 = q->t1 > q->t0 ? q->t1 : q->t0 + 7 * 3600;
  memset(vol_slot, 0, sizeof vol_slot);
  memset(avg_slot, 0, sizeof avg_slot);
  memset(px_on, 0, sizeof px_on);
  vol_max = vhi;
  ball_slot = -1;
  for (int i = 0; i < q->n; i++) {
    int slot = q->slot[i];
    if (slot < 0 || slot >= TAPE_SLOTS) continue;
    if (q->vl[i] > 0) vol_slot[slot] = q->vl[i];
    if (q->va[i] > 0) avg_slot[slot] = q->va[i];
    px_slot[slot] = q->px[i];
    px_on[slot] = 1;
    if (ball_slot < slot) ball_slot = slot;
  }
  int span_slots = ball_slot > 0 ? ball_slot : 1;
  int32_t full0 = q->t0;
  int32_t full1 = axis_t1;
  int32_t full = full1 - full0;
  if (full < 60) full = SPAN_SEC[0];
  int want = SPAN_SEC[span_i];
  int origin = 0;
  if (full > want && span_slots > 1) {
    origin = span_slots - (int)((int64_t)span_slots * want / full);
    if (origin < 0) origin = 0;
    if (origin >= span_slots) origin = span_slots - 1;
  }
  slot_origin = origin;
  slot_span = span_slots;
  axis_t0 = full0 + (int32_t)((int64_t)(full1 - full0) * slot_origin / span_slots);
  if (axis_t0 < full0) axis_t0 = full0;
  if (!(axis_t1 > axis_t0)) axis_t0 = full0;
  mark_sec = SPAN_MARK[span_i];
  bool any = false;
  float vlo = 0;
  float vhi_px = 0;
  float vmax = 0;
  for (int i = slot_origin; i <= slot_span && i < TAPE_SLOTS; i++) {
    if (px_on[i]) {
      if (!any || px_slot[i] < vlo) vlo = px_slot[i];
      if (!any || px_slot[i] > vhi_px) vhi_px = px_slot[i];
      any = true;
    }
    if (vol_slot[i] > vmax) vmax = vol_slot[i];
    if (avg_slot[i] > vmax) vmax = avg_slot[i];
  }
  if (any) {
    vol_max = vmax > 0 ? vmax : vol_max;
    float mid = (vlo + vhi_px) / 2.f;
    if (!(mid > 0)) mid = base > 0 ? base : 1.f;
    float half = (vhi_px - vlo) / 2.f / mid * 100.f;
    if (half < 0.2f) half = 0.2f;
    step = axis_step(half);
    plo = mid * (1.f - step / 100.f);
    phi = mid * (1.f + step / 100.f);
    plot_lo = plo;
    plot_hi = phi;
  }
  int prev = -1;
  int dir = 0;
  for (int i = slot_origin; i < TAPE_SLOTS; i++) {
    if (!px_on[i]) {
      prev = -1;
      continue;
    }
    if (prev >= 0 && i == prev + 1) {
      if (px_slot[i] > px_slot[prev] + 0.001f) dir = 1;
      else if (px_slot[i] < px_slot[prev] - 0.001f) dir = -1;
    }
    prev = i;
  }
  ball_ink = dir > 0 ? lv_color_hex(0x3DDC97) : dir < 0 ? lv_color_hex(0xFF6B6B) : lv_color_hex(0xF2F0E6);

  lv_obj_t *price = lv_chart_create(list);
  lv_obj_set_width(price, lv_pct(100));
  lv_obj_set_flex_grow(price, 1);
  lv_obj_set_height(price, 0);
  style_chart(price);
  lv_obj_set_style_pad_left(price, 16, 0);
  lv_obj_set_style_pad_right(price, 12, 0);
  lv_obj_set_style_pad_top(price, 36, 0);
  lv_obj_set_style_pad_bottom(price, 2, 0);
  lv_obj_clear_flag(price, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(price, LV_OBJ_FLAG_OVERFLOW_VISIBLE);
  lv_obj_add_event_cb(price, on_chart_draw, (lv_event_code_t)(LV_EVENT_DRAW_MAIN | LV_EVENT_PREPROCESS), nullptr);
  lv_obj_add_event_cb(price, on_chart_draw, LV_EVENT_DRAW_POST, nullptr);
  lv_obj_add_event_cb(price, on_chart_size, LV_EVENT_SIZE_CHANGED, nullptr);
  lv_chart_set_type(price, LV_CHART_TYPE_LINE);
  lv_chart_set_point_count(price, TAPE_SLOTS);
  lv_chart_set_range(price, LV_CHART_AXIS_PRIMARY_Y, 0, 1000);
  if (q->level > 0 && q->level >= plo && q->level <= phi) {
    lv_chart_series_t *ls = lv_chart_add_series(price, lv_color_hex(0xD4A6FF), LV_CHART_AXIS_PRIMARY_Y);
    lv_chart_set_all_value(price, ls, scale_point(q->level, plo, phi));
  }
  ball = nullptr;
  if (ball_slot >= 0) {
    ball = lv_obj_create(price);
    lv_obj_set_size(ball, 10, 10);
    lv_obj_set_style_radius(ball, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(ball, ball_ink, 0);
    lv_obj_set_style_bg_opa(ball, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(ball, 0, 0);
    lv_obj_set_style_transform_pivot_x(ball, LV_PCT(50), 0);
    lv_obj_set_style_transform_pivot_y(ball, LV_PCT(50), 0);
    lv_obj_clear_flag(ball, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_clear_flag(ball, LV_OBJ_FLAG_SCROLLABLE);
    lv_anim_t beat;
    lv_anim_init(&beat);
    lv_anim_set_var(&beat, ball);
    lv_anim_set_exec_cb(&beat, [](void *obj, int32_t v) {
      lv_obj_set_style_transform_zoom((lv_obj_t *)obj, (lv_coord_t)v, 0);
    });
    lv_anim_set_values(&beat, 256, 430);
    lv_anim_set_time(&beat, 220);
    lv_anim_set_playback_time(&beat, 280);
    lv_anim_set_repeat_count(&beat, 1);
    lv_anim_start(&beat);
  }

  cap_label = lv_label_create(price);
  lv_label_set_text(cap_label, "Volumen de la sesión");
  lv_obj_set_style_text_font(cap_label, &font_latin_14, 0);
  lv_obj_set_style_text_color(cap_label, lv_color_hex(0x9AA392), 0);
  lv_obj_set_style_transform_pivot_x(cap_label, LV_PCT(50), 0);
  lv_obj_set_style_transform_pivot_y(cap_label, LV_PCT(50), 0);
  lv_obj_set_style_transform_angle(cap_label, 900, 0);
  lv_obj_clear_flag(cap_label, LV_OBJ_FLAG_CLICKABLE);

  vol_label = lv_label_create(price);
  lv_label_set_text(vol_label, q->volume[0] ? q->volume : "n/d");
  lv_obj_set_style_text_font(vol_label, &font_latin_14, 0);
  lv_obj_set_style_text_color(vol_label, lv_color_hex(0xE8D7A8), 0);
  lv_obj_clear_flag(vol_label, LV_OBJ_FLAG_CLICKABLE);

  char step_text[16];
  format_step(step_text, sizeof step_text, step);
  scale_label = lv_label_create(price);
  lv_label_set_text(scale_label, step_text);
  lv_obj_set_style_text_font(scale_label, &font_latin_14, 0);
  lv_obj_set_style_text_color(scale_label, lv_color_hex(0x9AA392), 0);
  lv_obj_clear_flag(scale_label, LV_OBJ_FLAG_CLICKABLE);
}

static void style_filters() {
  for (int i = 0; i < 2; i++) {
    if (!filter_btns[i]) continue;
    bool on = i == filter;
    lv_obj_set_style_bg_color(filter_btns[i], on ? lv_color_hex(0xC6A15B) : lv_color_hex(0x1C2118), 0);
    lv_obj_set_style_text_color(filter_btns[i], on ? lv_color_hex(0x1A1408) : lv_color_hex(0xF2F0E6), 0);
  }
}

static void open_detail(uint32_t id) {
  const Notice *n = store_find(id);
  if (!n || !detail) return;
  store_mark_read(id);
  char hm[8] = "--:--";
  format_hhmm(n->at, TZ_OFFSET_MIN, hm);
  lv_label_set_text(d_section, section_name(n->section));
  lv_obj_set_style_text_color(d_section, section_color(n->section), 0);
  lv_label_set_text(d_time, hm);
  lv_label_set_text(d_title, n->title);
  lv_label_set_text(d_message, n->message[0] ? n->message : " ");
  lv_obj_clear_flag(detail, LV_OBJ_FLAG_HIDDEN);
  lv_obj_move_foreground(detail);
  dirty = true;
}

static void on_card(lv_event_t *e) {
  uint32_t id = (uint32_t)(uintptr_t)lv_event_get_user_data(e);
  open_detail(id);
}

static void set_drawer(bool open) {
  drawer_open = open;
  if (open) drawer_ms = lv_tick_get();
  if (drawer) {
    if (open) lv_obj_clear_flag(drawer, LV_OBJ_FLAG_HIDDEN);
    else lv_obj_add_flag(drawer, LV_OBJ_FLAG_HIDDEN);
  }
  if (catcher) {
    if (open) lv_obj_clear_flag(catcher, LV_OBJ_FLAG_HIDDEN);
    else lv_obj_add_flag(catcher, LV_OBJ_FLAG_HIDDEN);
  }
  if (open && catcher) lv_obj_move_foreground(catcher);
  if (open && drawer) lv_obj_move_foreground(drawer);
  if (detail && !lv_obj_has_flag(detail, LV_OBJ_FLAG_HIDDEN)) lv_obj_move_foreground(detail);
}

static void on_rail(lv_event_t *) { set_drawer(!drawer_open); }

static void on_catcher(lv_event_t *) { set_drawer(false); }

static void on_filter(lv_event_t *e) {
  filter = (int)(uintptr_t)lv_event_get_user_data(e);
  style_filters();
  set_drawer(false);
  dirty = true;
}

static void on_back(lv_event_t *) {
  if (detail) lv_obj_add_flag(detail, LV_OBJ_FLAG_HIDDEN);
}

static void paint_card(const Notice *n) {
  lv_obj_t *card = lv_obj_create(list);
  lv_obj_set_width(card, lv_pct(100));
  lv_obj_set_height(card, LV_SIZE_CONTENT);
  lv_obj_set_style_bg_color(card, lv_color_hex(0x1C2118), 0);
  lv_obj_set_style_radius(card, 10, 0);
  lv_obj_set_style_pad_all(card, 8, 0);
  lv_obj_set_style_pad_left(card, 12, 0);
  lv_obj_set_style_border_side(card, LV_BORDER_SIDE_LEFT, 0);
  lv_obj_set_style_border_width(card, 4, 0);
  lv_obj_set_style_border_color(card, section_color(n->section), 0);
  lv_obj_set_flex_flow(card, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(card, 4, 0);
  lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_event_cb(card, on_card, LV_EVENT_CLICKED, (void *)(uintptr_t)n->id);

  lv_obj_t *row = lv_obj_create(card);
  lv_obj_set_width(row, lv_pct(100));
  lv_obj_set_height(row, LV_SIZE_CONTENT);
  lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(row, 0, 0);
  lv_obj_set_style_pad_all(row, 0, 0);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(row, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_clear_flag(row, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_clear_flag(row, LV_OBJ_FLAG_CLICKABLE);

  lv_obj_t *sec = lv_label_create(row);
  lv_label_set_text(sec, section_name(n->section));
  lv_obj_set_style_text_font(sec, &font_latin_14, 0);
  lv_obj_set_style_text_color(sec, section_color(n->section), 0);

  char hm[8] = "--:--";
  format_hhmm(n->at, TZ_OFFSET_MIN, hm);
  lv_obj_t *when = lv_label_create(row);
  lv_label_set_text(when, hm);
  lv_obj_set_style_text_font(when, &font_latin_14, 0);
  lv_obj_set_style_text_color(when, lv_color_hex(0x9AA392), 0);

  if (n->unread) {
    lv_obj_t *dot = lv_obj_create(row);
    lv_obj_set_size(dot, 8, 8);
    lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(dot, lv_color_hex(0xE8D7A8), 0);
    lv_obj_set_style_border_width(dot, 0, 0);
    lv_obj_clear_flag(dot, LV_OBJ_FLAG_CLICKABLE);
  }

  lv_obj_t *title = lv_label_create(card);
  lv_label_set_text(title, n->title);
  lv_obj_set_width(title, lv_pct(100));
  lv_label_set_long_mode(title, LV_LABEL_LONG_DOT);
  lv_obj_set_style_text_font(title, &font_latin_16, 0);
  lv_obj_set_style_text_color(title, lv_color_hex(0xF2F0E6), 0);
}

static void rebuild() {
  if (!list) return;
  cap_label = nullptr;
  vol_label = nullptr;
  scale_label = nullptr;
  ball = nullptr;
  bool detail_open = detail && !lv_obj_has_flag(detail, LV_OBJ_FLAG_HIDDEN);
  lv_obj_clean(list);
  if (strcmp(FILTER_ID[filter], "live") == 0) {
    lv_obj_add_flag(list, LV_OBJ_FLAG_SCROLLABLE);
    const TapeRow *q = tape_count() ? tape_at(tape_index()) : nullptr;
    if (!q) {
      lv_obj_t *empty = lv_label_create(list);
      lv_label_set_text(empty, "Nada en tiempo real");
      lv_obj_set_style_text_color(empty, lv_color_hex(0x9AA392), 0);
    } else {
      paint_live(q);
    }
    if (drawer_open && catcher && drawer) {
      lv_obj_move_foreground(catcher);
      lv_obj_move_foreground(drawer);
    }
    if (detail_open) lv_obj_move_foreground(detail);
    dirty = false;
    return;
  }
  lv_obj_add_flag(list, LV_OBJ_FLAG_SCROLLABLE);
  const char *want = FILTER_ID[filter];
  int shown = 0;
  for (int i = 0; i < store_count(); i++) {
    const Notice *n = store_at(i);
    if (want[0] && strcmp(n->section, want) != 0) continue;
    paint_card(n);
    shown++;
  }
  if (!shown) {
    lv_obj_t *empty = lv_label_create(list);
    lv_label_set_text(empty, want[0] ? "Nada en esta sección" : "Sin avisos");
    lv_obj_set_style_text_color(empty, lv_color_hex(0x9AA392), 0);
  }

  if (drawer_open && catcher && drawer) {
    lv_obj_move_foreground(catcher);
    lv_obj_move_foreground(drawer);
  }
  if (detail_open) lv_obj_move_foreground(detail);
  dirty = false;
}

static void refresh_battery();

void ui_init() {
  lv_obj_t *scr = lv_scr_act();
  lv_obj_set_style_bg_color(scr, lv_color_hex(0x12140F), 0);
  lv_obj_set_style_text_color(scr, lv_color_hex(0xF2F0E6), 0);
  lv_obj_set_style_text_font(scr, &font_latin_16, 0);
  lv_obj_set_style_pad_all(scr, 0, 0);
  lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

  Preferences prefs;
  if (prefs.begin("pantalla", true)) {
    spin_sec = prefs.getInt("spin", 15);
    prefs.end();
  }
  if (spin_sec < 5) spin_sec = 5;
  if (spin_sec > 180) spin_sec = 180;

  lv_obj_t *bar = lv_obj_create(scr);
  lv_obj_set_size(bar, SCREEN_W, 36);
  lv_obj_align(bar, LV_ALIGN_TOP_MID, 0, 0);
  lv_obj_set_style_bg_color(bar, lv_color_hex(0x12140F), 0);
  lv_obj_set_style_border_side(bar, LV_BORDER_SIDE_BOTTOM, 0);
  lv_obj_set_style_border_width(bar, 1, 0);
  lv_obj_set_style_border_color(bar, lv_color_hex(0x3C4436), 0);
  lv_obj_set_style_radius(bar, 0, 0);
  lv_obj_set_style_pad_hor(bar, 6, 0);
  lv_obj_set_style_pad_ver(bar, 0, 0);
  lv_obj_clear_flag(bar, LV_OBJ_FLAG_SCROLLABLE);

  lv_obj_t *menu_btn = lv_btn_create(bar);
  lv_obj_set_size(menu_btn, 68, 26);
  lv_obj_align(menu_btn, LV_ALIGN_LEFT_MID, 6, 0);
  lv_obj_set_style_radius(menu_btn, 8, 0);
  lv_obj_set_style_bg_color(menu_btn, lv_color_hex(0x1C2118), 0);
  lv_obj_set_style_shadow_width(menu_btn, 0, 0);
  lv_obj_set_style_pad_all(menu_btn, 0, 0);
  lv_obj_add_event_cb(menu_btn, on_rail, LV_EVENT_CLICKED, nullptr);
  lv_obj_t *menu_lbl = lv_label_create(menu_btn);
  lv_label_set_text(menu_lbl, "Menú");
  lv_obj_set_style_text_font(menu_lbl, &font_latin_14, 0);
  lv_obj_set_style_text_color(menu_lbl, lv_color_hex(0xF2F0E6), 0);
  lv_obj_center(menu_lbl);

  stale_box = lv_obj_create(bar);
  lv_obj_set_size(stale_box, LV_SIZE_CONTENT, 22);
  lv_obj_align(stale_box, LV_ALIGN_CENTER, 0, 0);
  lv_obj_set_style_bg_color(stale_box, lv_color_hex(0xFF4B3A), 0);
  lv_obj_set_style_radius(stale_box, 11, 0);
  lv_obj_set_style_border_width(stale_box, 0, 0);
  lv_obj_set_style_pad_hor(stale_box, 8, 0);
  lv_obj_set_style_pad_ver(stale_box, 0, 0);
  lv_obj_clear_flag(stale_box, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(stale_box, LV_OBJ_FLAG_HIDDEN);
  lv_obj_t *stale_lbl = lv_label_create(stale_box);
  lv_label_set_text(stale_lbl, "SIN DATOS");
  lv_obj_set_style_text_font(stale_lbl, &font_latin_14, 0);
  lv_obj_set_style_text_color(stale_lbl, lv_color_hex(0x1A100C), 0);
  lv_obj_center(stale_lbl);

  heart = lv_obj_create(bar);
  lv_obj_set_size(heart, 12, 12);
  lv_obj_align(heart, LV_ALIGN_RIGHT_MID, -156, 0);
  lv_obj_set_style_radius(heart, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_color(heart, lv_color_hex(0x8A9086), 0);
  lv_obj_set_style_bg_opa(heart, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(heart, 0, 0);
  lv_obj_set_style_pad_all(heart, 0, 0);
  lv_obj_clear_flag(heart, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_clear_flag(heart, LV_OBJ_FLAG_CLICKABLE);

  battery = lv_obj_create(bar);
  lv_obj_set_size(battery, 36, 18);
  lv_obj_align(battery, LV_ALIGN_RIGHT_MID, -112, 0);
  lv_obj_set_style_bg_opa(battery, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(battery, 0, 0);
  lv_obj_set_style_pad_all(battery, 0, 0);
  lv_obj_clear_flag(battery, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_clear_flag(battery, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_t *batt_body = lv_obj_create(battery);
  lv_obj_set_pos(batt_body, 0, 2);
  lv_obj_set_size(batt_body, 28, 14);
  lv_obj_set_style_bg_opa(batt_body, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(batt_body, 2, 0);
  lv_obj_set_style_border_color(batt_body, lv_color_hex(0xD7D4C8), 0);
  lv_obj_set_style_radius(batt_body, 2, 0);
  lv_obj_set_style_pad_all(batt_body, 0, 0);
  lv_obj_clear_flag(batt_body, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_clear_flag(batt_body, LV_OBJ_FLAG_CLICKABLE);
  batt_fill = lv_obj_create(batt_body);
  lv_obj_set_pos(batt_fill, 2, 2);
  lv_obj_set_size(batt_fill, 12, 8);
  lv_obj_set_style_bg_color(batt_fill, lv_color_hex(0x3DDC97), 0);
  lv_obj_set_style_bg_opa(batt_fill, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(batt_fill, 0, 0);
  lv_obj_set_style_radius(batt_fill, 1, 0);
  lv_obj_clear_flag(batt_fill, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_clear_flag(batt_fill, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_t *nub = lv_obj_create(battery);
  lv_obj_set_pos(nub, 29, 6);
  lv_obj_set_size(nub, 3, 6);
  lv_obj_set_style_bg_color(nub, lv_color_hex(0xD7D4C8), 0);
  lv_obj_set_style_bg_opa(nub, LV_OPA_COVER, 0);
  lv_obj_set_style_border_width(nub, 0, 0);
  lv_obj_set_style_radius(nub, 1, 0);
  lv_obj_clear_flag(nub, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_clear_flag(nub, LV_OBJ_FLAG_CLICKABLE);
  batt_mark = lv_label_create(battery);
  lv_obj_align(batt_mark, LV_ALIGN_CENTER, -3, 0);
  lv_label_set_text(batt_mark, "/");
  lv_obj_set_style_text_font(batt_mark, &font_latin_14, 0);
  lv_obj_set_style_text_color(batt_mark, lv_color_hex(0xFF6B6B), 0);
  lv_obj_add_flag(batt_mark, LV_OBJ_FLAG_HIDDEN);

  clock_label = lv_label_create(bar);
  lv_obj_align(clock_label, LV_ALIGN_RIGHT_MID, -6, 0);
  lv_obj_set_style_text_font(clock_label, &font_latin_14, 0);
  lv_obj_set_style_text_color(clock_label, lv_color_hex(0x9AA392), 0);
  lv_label_set_text(clock_label, "--:--:--");

  list = lv_obj_create(scr);
  lv_obj_set_pos(list, 0, 36);
  lv_obj_set_size(list, SCREEN_W, SCREEN_H - 36);
  lv_obj_set_style_bg_opa(list, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(list, 0, 0);
  lv_obj_set_style_pad_all(list, 8, 0);
  lv_obj_set_style_pad_row(list, 6, 0);
  lv_obj_set_flex_flow(list, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_scrollbar_mode(list, LV_SCROLLBAR_MODE_ACTIVE);

  catcher = lv_obj_create(scr);
  lv_obj_set_pos(catcher, 0, 36);
  lv_obj_set_size(catcher, SCREEN_W, SCREEN_H - 36);
  lv_obj_set_style_bg_opa(catcher, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(catcher, 0, 0);
  lv_obj_clear_flag(catcher, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(catcher, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_event_cb(catcher, on_catcher, LV_EVENT_CLICKED, nullptr);

  drawer = lv_obj_create(scr);
  lv_obj_set_pos(drawer, 6, 36);
  lv_obj_set_size(drawer, 156, 108);
  lv_obj_set_style_bg_color(drawer, lv_color_hex(0x171B13), 0);
  lv_obj_set_style_border_color(drawer, lv_color_hex(0xC6A15B), 0);
  lv_obj_set_style_border_width(drawer, 1, 0);
  lv_obj_set_style_radius(drawer, 8, 0);
  lv_obj_set_style_pad_all(drawer, 8, 0);
  lv_obj_set_style_pad_row(drawer, 8, 0);
  lv_obj_set_flex_flow(drawer, LV_FLEX_FLOW_COLUMN);
  lv_obj_clear_flag(drawer, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(drawer, LV_OBJ_FLAG_HIDDEN);
  for (int i = 0; i < 2; i++) {
    lv_obj_t *btn = lv_btn_create(drawer);
    lv_obj_set_size(btn, 120, 36);
    lv_obj_set_style_radius(btn, 8, 0);
    lv_obj_set_style_shadow_width(btn, 0, 0);
    lv_obj_set_style_pad_all(btn, 0, 0);
    lv_obj_add_event_cb(btn, on_filter, LV_EVENT_CLICKED, (void *)(uintptr_t)i);
    lv_obj_t *lbl = lv_label_create(btn);
    lv_label_set_text(lbl, FILTERS[i]);
    lv_obj_set_style_text_font(lbl, &font_latin_14, 0);
    lv_obj_center(lbl);
    filter_btns[i] = btn;
  }
  style_filters();

  spin_box = lv_obj_create(scr);
  lv_obj_set_size(spin_box, 210, 150);
  lv_obj_align(spin_box, LV_ALIGN_CENTER, 0, 0);
  lv_obj_set_style_bg_color(spin_box, lv_color_hex(0x1C2118), 0);
  lv_obj_set_style_border_color(spin_box, lv_color_hex(0xC6A15B), 0);
  lv_obj_set_style_border_width(spin_box, 1, 0);
  lv_obj_set_style_radius(spin_box, 12, 0);
  lv_obj_set_style_pad_all(spin_box, 0, 0);
  lv_obj_clear_flag(spin_box, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(spin_box, LV_OBJ_FLAG_HIDDEN);
  lv_obj_t *spin_title = lv_label_create(spin_box);
  lv_label_set_text(spin_title, "Rotar cada");
  lv_obj_set_style_text_font(spin_title, &font_latin_14, 0);
  lv_obj_set_style_text_color(spin_title, lv_color_hex(0x9AA392), 0);
  lv_obj_align(spin_title, LV_ALIGN_TOP_MID, 0, 8);
  spin_value = lv_label_create(spin_box);
  lv_obj_set_width(spin_value, 160);
  lv_obj_set_height(spin_value, 28);
  lv_label_set_text_fmt(spin_value, "%d s", spin_sec);
  lv_obj_set_style_text_font(spin_value, &font_latin_18, 0);
  lv_obj_set_style_text_color(spin_value, lv_color_hex(0xF2F0E6), 0);
  lv_obj_set_style_text_align(spin_value, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_align(spin_value, LV_ALIGN_TOP_MID, 0, 34);
  lv_obj_t *spin_row = lv_obj_create(spin_box);
  lv_obj_set_size(spin_row, 180, 32);
  lv_obj_align(spin_row, LV_ALIGN_TOP_MID, 0, 70);
  lv_obj_set_style_bg_opa(spin_row, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(spin_row, 0, 0);
  lv_obj_set_style_pad_all(spin_row, 0, 0);
  lv_obj_set_flex_flow(spin_row, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(spin_row, LV_FLEX_ALIGN_SPACE_EVENLY, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_clear_flag(spin_row, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_t *minus = lv_btn_create(spin_row);
  lv_obj_set_size(minus, 48, 28);
  lv_obj_set_style_shadow_width(minus, 0, 0);
  lv_obj_add_event_cb(minus, on_spin_delta, LV_EVENT_CLICKED, (void *)(intptr_t)-5);
  lv_obj_t *minus_lbl = lv_label_create(minus);
  lv_label_set_text(minus_lbl, "-");
  lv_obj_center(minus_lbl);
  lv_obj_t *plus = lv_btn_create(spin_row);
  lv_obj_set_size(plus, 48, 28);
  lv_obj_set_style_shadow_width(plus, 0, 0);
  lv_obj_add_event_cb(plus, on_spin_delta, LV_EVENT_CLICKED, (void *)(intptr_t)5);
  lv_obj_t *plus_lbl = lv_label_create(plus);
  lv_label_set_text(plus_lbl, "+");
  lv_obj_center(plus_lbl);
  lv_obj_t *done = lv_btn_create(spin_box);
  lv_obj_set_size(done, 88, 28);
  lv_obj_set_style_bg_color(done, lv_color_hex(0xC6A15B), 0);
  lv_obj_set_style_shadow_width(done, 0, 0);
  lv_obj_align(done, LV_ALIGN_BOTTOM_MID, 0, -8);
  lv_obj_add_event_cb(done, on_spin_close, LV_EVENT_CLICKED, nullptr);
  lv_obj_t *done_lbl = lv_label_create(done);
  lv_label_set_text(done_lbl, "Listo");
  lv_obj_set_style_text_color(done_lbl, lv_color_hex(0x1A1408), 0);
  lv_obj_set_style_text_font(done_lbl, &font_latin_14, 0);
  lv_obj_center(done_lbl);

  detail = lv_obj_create(scr);
  lv_obj_set_size(detail, SCREEN_W, SCREEN_H);
  lv_obj_align(detail, LV_ALIGN_TOP_MID, 0, 0);
  lv_obj_set_style_bg_color(detail, lv_color_hex(0x12140F), 0);
  lv_obj_set_style_border_width(detail, 0, 0);
  lv_obj_set_style_pad_all(detail, 12, 0);
  lv_obj_add_flag(detail, LV_OBJ_FLAG_HIDDEN);
  lv_obj_clear_flag(detail, LV_OBJ_FLAG_SCROLLABLE);

  lv_obj_t *back = lv_btn_create(detail);
  lv_obj_set_size(back, 88, 32);
  lv_obj_align(back, LV_ALIGN_TOP_LEFT, 0, 0);
  lv_obj_set_style_bg_color(back, lv_color_hex(0x1C2118), 0);
  lv_obj_set_style_shadow_width(back, 0, 0);
  lv_obj_add_event_cb(back, on_back, LV_EVENT_CLICKED, nullptr);
  lv_obj_t *back_lbl = lv_label_create(back);
  lv_label_set_text(back_lbl, "Volver");
  lv_obj_set_style_text_font(back_lbl, &font_latin_14, 0);
  lv_obj_center(back_lbl);

  d_section = lv_label_create(detail);
  lv_obj_align(d_section, LV_ALIGN_TOP_LEFT, 0, 44);
  lv_obj_set_style_text_font(d_section, &font_latin_14, 0);

  d_time = lv_label_create(detail);
  lv_obj_align(d_time, LV_ALIGN_TOP_RIGHT, 0, 44);
  lv_obj_set_style_text_font(d_time, &font_latin_14, 0);
  lv_obj_set_style_text_color(d_time, lv_color_hex(0x9AA392), 0);

  d_title = lv_label_create(detail);
  lv_obj_set_width(d_title, SCREEN_W - 24);
  lv_obj_align(d_title, LV_ALIGN_TOP_LEFT, 0, 68);
  lv_label_set_long_mode(d_title, LV_LABEL_LONG_WRAP);
  lv_obj_set_style_text_font(d_title, &font_latin_18, 0);

  lv_obj_t *body = lv_obj_create(detail);
  lv_obj_set_size(body, SCREEN_W - 24, SCREEN_H - 160);
  lv_obj_align(body, LV_ALIGN_TOP_LEFT, 0, 130);
  lv_obj_set_style_bg_opa(body, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(body, 0, 0);
  lv_obj_set_style_pad_all(body, 0, 0);

  d_message = lv_label_create(body);
  lv_obj_set_width(d_message, SCREEN_W - 24);
  lv_label_set_long_mode(d_message, LV_LABEL_LONG_WRAP);
  lv_obj_set_style_text_font(d_message, &font_latin_16, 0);
  lv_obj_set_style_text_color(d_message, lv_color_hex(0xD7D4C8), 0);

  ui_set_link(false);
  dirty = true;
}

static void heart_blink(void *, int32_t v) {
  if (heart) lv_obj_set_style_bg_opa(heart, (lv_opa_t)v, 0);
}

static void refresh_battery() {
  if (!batt_fill || !batt_mark) return;
  if (batt_state == 0) {
    lv_obj_add_flag(batt_fill, LV_OBJ_FLAG_HIDDEN);
    lv_obj_clear_flag(batt_mark, LV_OBJ_FLAG_HIDDEN);
    lv_label_set_text(batt_mark, "/");
    lv_obj_set_style_text_color(batt_mark, lv_color_hex(0xFF6B6B), 0);
    return;
  }
  lv_obj_clear_flag(batt_fill, LV_OBJ_FLAG_HIDDEN);
  int width = batt_pct * 22 / 100;
  if (width < 2 && batt_pct > 0) width = 2;
  if (width > 22) width = 22;
  lv_obj_set_width(batt_fill, width);
  lv_obj_set_style_bg_color(batt_fill, lv_color_hex(batt_pct < 15 && batt_state != 1 ? 0xFF6B6B : 0x3DDC97), 0);
  if (batt_state == 1) {
    lv_obj_clear_flag(batt_mark, LV_OBJ_FLAG_HIDDEN);
    lv_label_set_text(batt_mark, "+");
    lv_obj_set_style_text_color(batt_mark, lv_color_hex(0xF2E3B0), 0);
  } else {
    lv_obj_add_flag(batt_mark, LV_OBJ_FLAG_HIDDEN);
  }
}

void ui_reload() { dirty = true; }

void ui_note_quote() { last_quote_ms = lv_tick_get(); }

void ui_set_clock(int32_t unix_sec) {
  if (!clock_label || unix_sec <= 0) return;
  char hm[16];
  format_clock(unix_sec, hm, sizeof hm, true);
  lv_label_set_text(clock_label, hm);
}

void ui_set_link(bool online) {
  link_on = online;
  if (!heart) return;
  lv_anim_del(heart, heart_blink);
  lv_obj_set_style_bg_color(heart, lv_color_hex(online ? 0xFF3355 : 0x8A9086), 0);
  lv_obj_set_style_bg_opa(heart, LV_OPA_COVER, 0);
  if (online) {
    lv_anim_t beat;
    lv_anim_init(&beat);
    lv_anim_set_var(&beat, heart);
    lv_anim_set_exec_cb(&beat, heart_blink);
    lv_anim_set_values(&beat, LV_OPA_COVER, LV_OPA_20);
    lv_anim_set_time(&beat, 180);
    lv_anim_set_playback_time(&beat, 420);
    lv_anim_set_repeat_delay(&beat, 360);
    lv_anim_set_repeat_count(&beat, LV_ANIM_REPEAT_INFINITE);
    lv_anim_start(&beat);
  }
}

void ui_pump() {
  uint32_t now = lv_tick_get();
  if (drawer_open && lv_tick_elaps(drawer_ms) >= 10000) set_drawer(false);
  if (auto_spin && !spin_hold && strcmp(FILTER_ID[filter], "live") == 0 && tape_count() > 1) {
    if (spin_ms == 0) spin_ms = now;
    if (lv_tick_elaps(spin_ms) >= (uint32_t)spin_sec * 1000u) {
      pin_step(1);
      spin_ms = lv_tick_get();
    }
  }
  if (batt_ms == 0 || lv_tick_elaps(batt_ms) >= 2000) {
    batt_ms = now;
    BattSample sample = battery_read();
    batt_state = sample.state == BattState::Absent ? 0 : sample.state == BattState::Charging ? 1 : 2;
    batt_pct = sample.pct;
    refresh_battery();
  }
  if (dirty) rebuild();
  if (!stale_box) return;
  bool late = last_quote_ms == 0 ? now > 20000 : now - last_quote_ms > 15000;
  if (!late) {
    if (!lv_obj_has_flag(stale_box, LV_OBJ_FLAG_HIDDEN)) lv_obj_add_flag(stale_box, LV_OBJ_FLAG_HIDDEN);
    return;
  }
  if (lv_obj_has_flag(stale_box, LV_OBJ_FLAG_HIDDEN)) lv_obj_clear_flag(stale_box, LV_OBJ_FLAG_HIDDEN);
  lv_obj_set_style_bg_opa(stale_box, ((now / 320) & 1) ? LV_OPA_COVER : LV_OPA_30, 0);
}
