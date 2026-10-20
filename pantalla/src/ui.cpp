#include "ui.h"

#include "config.h"
#include "store.h"
#include "tape.h"
#include "textutil.h"

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
static lv_obj_t *stale_box = nullptr;
static lv_obj_t *unread_label = nullptr;
static lv_obj_t *clock_label = nullptr;
static lv_obj_t *filter_btns[2] = {};
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
static lv_color_t ball_ink = lv_color_hex(0xF2F0E6);
static lv_obj_t *ball = nullptr;
static lv_obj_t *timed_chart = nullptr;
static uint32_t last_quote_ms = 0;
static lv_obj_t *cap_label = nullptr;
static lv_obj_t *vol_label = nullptr;
static lv_obj_t *scale_label = nullptr;

static const int PLOT_INSET = 10;

static int inner_x(int origin, int width, int slot) {
  int denom = slot_span > 0 ? slot_span : 1;
  int inner = width - PLOT_INSET * 2;
  if (inner < 8) return origin + (int)((int32_t)width * slot) / denom;
  return origin + PLOT_INSET + (int)((int32_t)inner * slot) / denom;
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
  static const float steps[] = {0.5f, 1.f, 2.f, 3.f, 5.f, 10.f, 15.f, 20.f, 30.f, 50.f, 100.f};
  for (float step : steps) {
    if (max_abs_pct <= step) return step;
  }
  float step = 100.f;
  while (step < max_abs_pct && step < 10000.f) step *= 2.f;
  return step;
}

static void format_step(char *out, size_t n, float step) {
  if (step < 1.f) snprintf(out, n, "\xC2\xB1" "0,5%%");
  else snprintf(out, n, "\xC2\xB1" "%.0f%%", step);
}

static void place_sideways(lv_obj_t *chart, const char *text, int content_x, lv_color_t color) {
  lv_obj_t *lbl = lv_label_create(chart);
  lv_label_set_text(lbl, text);
  lv_obj_set_style_text_font(lbl, &lv_font_montserrat_12, 0);
  lv_obj_set_style_text_color(lbl, color, 0);
  lv_obj_set_style_transform_pivot_x(lbl, LV_PCT(50), 0);
  lv_obj_set_style_transform_pivot_y(lbl, LV_PCT(50), 0);
  lv_obj_set_style_transform_angle(lbl, 900, 0);
  lv_obj_clear_flag(lbl, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_update_layout(lbl);
  lv_coord_t cw = lv_obj_get_width(lbl);
  lv_coord_t ch = lv_obj_get_height(lbl);
  lv_coord_t pad_top = lv_obj_get_style_pad_top(chart, LV_PART_MAIN);
  lv_coord_t cy = -pad_top + 2 + cw / 2;
  lv_obj_set_pos(lbl, content_x - cw / 2, cy - ch / 2);
}

static void place_times(lv_obj_t *chart) {
  if (axis_t1 <= axis_t0) return;
  lv_coord_t w = lv_obj_get_content_width(chart);
  if (w < 40) return;
  int64_t local0 = (int64_t)axis_t0 + (int64_t)TZ_OFFSET_MIN * 60;
  int64_t local1 = (int64_t)axis_t1 + (int64_t)TZ_OFFSET_MIN * 60;
  int64_t span = local1 - local0;
  if (span <= 0) return;
  int live_x = (int)w - PLOT_INSET;
  int64_t rem = ((local0 % 1800) + 1800) % 1800;
  for (int64_t mark = rem == 0 ? local0 : local0 + (1800 - rem); mark < local1; mark += 1800) {
    int x = PLOT_INSET + (int)((mark - local0) * (w - PLOT_INSET * 2) / span);
    if (x < PLOT_INSET || x >= live_x - 16) continue;
    char text[8];
    format_clock((int32_t)(mark - (int64_t)TZ_OFFSET_MIN * 60), text, sizeof text, false);
    place_sideways(chart, text, x, lv_color_hex(0xC5CBB8));
  }
  char now[12];
  format_clock(axis_t1, now, sizeof now, true);
  place_sideways(chart, now, live_x, lv_color_hex(0xF2F0E6));
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
    lv_obj_set_pos(scale_label, plot_w - sw - PLOT_INSET, 0);
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
  if (timed_chart != chart && lv_obj_get_content_width(chart) > 40) {
    place_times(chart);
    timed_chart = chart;
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
      int bw = (int)w / (slot_span + 1);
      if (bw < 2) bw = 2;
      if (bw > 4) bw = 4;
      lv_draw_rect_dsc_t rd;
      lv_draw_rect_dsc_init(&rd);
      rd.bg_color = lv_color_hex(0xE0A100);
      rd.bg_opa = LV_OPA_70;
      rd.border_width = 0;
      for (int i = 0; i < TAPE_SLOTS; i++) {
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
  int64_t rem = ((local0 % 1800) + 1800) % 1800;
  int64_t mark = rem == 0 ? local0 : local0 + (1800 - rem);
  lv_draw_line_dsc_t dsc;
  lv_draw_line_dsc_init(&dsc);
  dsc.color = lv_color_hex(0xC6A15B);
  dsc.width = 1;
  dsc.opa = LV_OPA_30;
  int inner = (int)w - PLOT_INSET * 2;
  if (inner < 8) inner = (int)w;
  for (; mark < local1; mark += 1800) {
    int x = (int)x_ofs + PLOT_INSET + (int)((mark - local0) * inner / span);
    if (x <= (int)x_ofs + PLOT_INSET || x >= (int)x_ofs + (int)w - PLOT_INSET) continue;
    lv_point_t p1 = {(lv_coord_t)x, (lv_coord_t)(y_ofs + 1)};
    lv_point_t p2 = {(lv_coord_t)x, (lv_coord_t)(y_ofs + h - 1)};
    lv_draw_line(ctx, &dsc, &p1, &p2);
  }
  if (!(plot_hi > plot_lo)) return;
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

static void paint_live(const TapeRow *q) {
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
    snprintf(extra, sizeof extra, "%.2f  %+.1f%%", q->level, pct);
    lv_obj_t *nl = lv_label_create(head);
    lv_label_set_text(nl, extra);
    lv_obj_set_style_text_font(nl, &font_latin_14, 0);
    lv_obj_set_style_text_color(nl, lv_color_hex(0xD4A6FF), 0);
  }

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
  if (q->level > 0) {
    float lv_abs = fabsf((q->level - base) / base * 100.f);
    if (lv_abs > max_abs) max_abs = lv_abs;
  }
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
  slot_span = ball_slot > 0 ? ball_slot : TAPE_SLOTS - 1;
  int prev = -1;
  int dir = 0;
  for (int i = 0; i < TAPE_SLOTS; i++) {
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
  if (q->level > 0) {
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

static void on_filter(lv_event_t *e) {
  filter = (int)(uintptr_t)lv_event_get_user_data(e);
  style_filters();
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
  timed_chart = nullptr;
  bool detail_open = detail && !lv_obj_has_flag(detail, LV_OBJ_FLAG_HIDDEN);
  lv_obj_clean(list);
  if (strcmp(FILTER_ID[filter], "live") == 0) {
    lv_obj_add_flag(list, LV_OBJ_FLAG_SCROLLABLE);
    const TapeRow *q = tape_count() ? tape_at(0) : nullptr;
    if (!q) {
      lv_obj_t *empty = lv_label_create(list);
      lv_label_set_text(empty, "Nada en tiempo real");
      lv_obj_set_style_text_color(empty, lv_color_hex(0x9AA392), 0);
    } else {
      paint_live(q);
    }
    int unread = store_unread();
    if (unread_label) lv_label_set_text_fmt(unread_label, unread ? "%d" : "al día", unread);
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

  int unread = store_unread();
  if (unread_label) lv_label_set_text_fmt(unread_label, unread ? "%d" : "al día", unread);

  char hm[8] = "--:--";
  if (store_count()) format_hhmm(store_at(0)->at, TZ_OFFSET_MIN, hm);
  if (clock_label) lv_label_set_text(clock_label, hm);
  if (detail_open) lv_obj_move_foreground(detail);
  dirty = false;
}

static void on_heart_draw(lv_event_t *e);

void ui_init() {
  lv_obj_t *scr = lv_scr_act();
  lv_obj_set_style_bg_color(scr, lv_color_hex(0x12140F), 0);
  lv_obj_set_style_text_color(scr, lv_color_hex(0xF2F0E6), 0);
  lv_obj_set_style_text_font(scr, &font_latin_16, 0);
  lv_obj_set_style_pad_all(scr, 0, 0);
  lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

  lv_obj_t *bar = lv_obj_create(scr);
  lv_obj_set_size(bar, SCREEN_W, 36);
  lv_obj_align(bar, LV_ALIGN_TOP_MID, 0, 0);
  lv_obj_set_style_bg_color(bar, lv_color_hex(0x12140F), 0);
  lv_obj_set_style_border_width(bar, 0, 0);
  lv_obj_set_style_pad_hor(bar, 6, 0);
  lv_obj_set_style_pad_ver(bar, 0, 0);
  lv_obj_set_flex_flow(bar, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(bar, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_clear_flag(bar, LV_OBJ_FLAG_SCROLLABLE);

  lv_obj_t *filters = lv_obj_create(bar);
  lv_obj_set_size(filters, LV_SIZE_CONTENT, 36);
  lv_obj_set_style_bg_opa(filters, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(filters, 0, 0);
  lv_obj_set_style_pad_all(filters, 0, 0);
  lv_obj_set_style_pad_column(filters, 4, 0);
  lv_obj_set_flex_flow(filters, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(filters, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_clear_flag(filters, LV_OBJ_FLAG_SCROLLABLE);

  for (int i = 0; i < 2; i++) {
    lv_obj_t *btn = lv_btn_create(filters);
    lv_obj_set_size(btn, LV_SIZE_CONTENT, 26);
    lv_obj_set_style_radius(btn, 13, 0);
    lv_obj_set_style_shadow_width(btn, 0, 0);
    lv_obj_set_style_pad_hor(btn, 10, 0);
    lv_obj_set_style_pad_ver(btn, 0, 0);
    lv_obj_add_event_cb(btn, on_filter, LV_EVENT_CLICKED, (void *)(uintptr_t)i);
    lv_obj_t *lbl = lv_label_create(btn);
    lv_label_set_text(lbl, FILTERS[i]);
    lv_obj_set_style_text_font(lbl, &font_latin_14, 0);
    lv_obj_center(lbl);
    filter_btns[i] = btn;
  }
  style_filters();

  lv_obj_t *mid = lv_obj_create(bar);
  lv_obj_set_height(mid, 36);
  lv_obj_set_flex_grow(mid, 1);
  lv_obj_set_style_bg_opa(mid, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(mid, 0, 0);
  lv_obj_set_style_pad_all(mid, 0, 0);
  lv_obj_clear_flag(mid, LV_OBJ_FLAG_SCROLLABLE);
  stale_box = lv_obj_create(mid);
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

  lv_obj_t *status = lv_obj_create(bar);
  lv_obj_set_size(status, LV_SIZE_CONTENT, 36);
  lv_obj_set_style_bg_opa(status, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(status, 0, 0);
  lv_obj_set_style_pad_all(status, 0, 0);
  lv_obj_set_style_pad_column(status, 8, 0);
  lv_obj_set_flex_flow(status, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(status, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_clear_flag(status, LV_OBJ_FLAG_SCROLLABLE);

  heart = lv_obj_create(status);
  lv_obj_set_size(heart, 18, 16);
  lv_obj_set_style_bg_opa(heart, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(heart, 0, 0);
  lv_obj_set_style_pad_all(heart, 0, 0);
  lv_obj_set_style_transform_pivot_x(heart, LV_PCT(50), 0);
  lv_obj_set_style_transform_pivot_y(heart, LV_PCT(50), 0);
  lv_obj_clear_flag(heart, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_clear_flag(heart, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_event_cb(heart, on_heart_draw, LV_EVENT_DRAW_MAIN, nullptr);

  unread_label = lv_label_create(status);
  lv_obj_set_style_text_font(unread_label, &font_latin_14, 0);
  lv_obj_set_style_text_color(unread_label, lv_color_hex(0xE8D7A8), 0);
  lv_label_set_text(unread_label, "");

  clock_label = lv_label_create(status);
  lv_obj_set_style_text_font(clock_label, &font_latin_14, 0);
  lv_obj_set_style_text_color(clock_label, lv_color_hex(0x9AA392), 0);
  lv_label_set_text(clock_label, "--:--");

  list = lv_obj_create(scr);
  lv_obj_set_size(list, SCREEN_W, SCREEN_H - 36);
  lv_obj_align(list, LV_ALIGN_TOP_MID, 0, 36);
  lv_obj_set_style_bg_opa(list, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(list, 0, 0);
  lv_obj_set_style_pad_all(list, 8, 0);
  lv_obj_set_style_pad_row(list, 6, 0);
  lv_obj_set_flex_flow(list, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_scrollbar_mode(list, LV_SCROLLBAR_MODE_ACTIVE);

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

static void heart_zoom(void *obj, int32_t v) {
  lv_obj_set_style_transform_zoom((lv_obj_t *)obj, (lv_coord_t)v, 0);
}

static void on_heart_draw(lv_event_t *e) {
  lv_obj_t *obj = lv_event_get_target(e);
  lv_draw_ctx_t *ctx = lv_event_get_draw_ctx(e);
  if (!ctx) return;
  lv_coord_t x = obj->coords.x1;
  lv_coord_t y = obj->coords.y1;
  lv_point_t pts[] = {
      {(lv_coord_t)(x + 9), (lv_coord_t)(y + 15)},
      {(lv_coord_t)(x + 1), (lv_coord_t)(y + 7)},
      {(lv_coord_t)(x + 1), (lv_coord_t)(y + 4)},
      {(lv_coord_t)(x + 3), (lv_coord_t)(y + 1)},
      {(lv_coord_t)(x + 6), (lv_coord_t)(y + 1)},
      {(lv_coord_t)(x + 9), (lv_coord_t)(y + 4)},
      {(lv_coord_t)(x + 12), (lv_coord_t)(y + 1)},
      {(lv_coord_t)(x + 15), (lv_coord_t)(y + 1)},
      {(lv_coord_t)(x + 17), (lv_coord_t)(y + 4)},
      {(lv_coord_t)(x + 17), (lv_coord_t)(y + 7)},
  };
  lv_draw_rect_dsc_t dsc;
  lv_draw_rect_dsc_init(&dsc);
  dsc.bg_color = link_on ? lv_color_hex(0xFF3B4E) : lv_color_hex(0x3A2428);
  dsc.bg_opa = LV_OPA_COVER;
  dsc.border_width = 0;
  lv_draw_polygon(ctx, &dsc, pts, sizeof pts / sizeof pts[0]);
}

void ui_reload() { dirty = true; }

void ui_note_quote() { last_quote_ms = lv_tick_get(); }

void ui_set_link(bool online) {
  link_on = online;
  if (!heart) return;
  lv_anim_del(heart, heart_zoom);
  lv_obj_set_style_transform_zoom(heart, 256, 0);
  if (online) {
    lv_anim_t beat;
    lv_anim_init(&beat);
    lv_anim_set_var(&beat, heart);
    lv_anim_set_exec_cb(&beat, heart_zoom);
    lv_anim_set_values(&beat, 256, 360);
    lv_anim_set_time(&beat, 160);
    lv_anim_set_playback_time(&beat, 420);
    lv_anim_set_repeat_delay(&beat, 480);
    lv_anim_set_repeat_count(&beat, LV_ANIM_REPEAT_INFINITE);
    lv_anim_start(&beat);
  }
  lv_obj_invalidate(heart);
}

void ui_pump() {
  if (dirty) rebuild();
  if (!stale_box) return;
  uint32_t now = lv_tick_get();
  bool late = last_quote_ms == 0 ? now > 20000 : now - last_quote_ms > 15000;
  if (!late) {
    if (!lv_obj_has_flag(stale_box, LV_OBJ_FLAG_HIDDEN)) lv_obj_add_flag(stale_box, LV_OBJ_FLAG_HIDDEN);
    return;
  }
  if (lv_obj_has_flag(stale_box, LV_OBJ_FLAG_HIDDEN)) lv_obj_clear_flag(stale_box, LV_OBJ_FLAG_HIDDEN);
  lv_obj_set_style_bg_opa(stale_box, ((now / 320) & 1) ? LV_OPA_COVER : LV_OPA_30, 0);
}
