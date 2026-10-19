#include "ui.h"

#include "config.h"
#include "store.h"
#include "tape.h"
#include "textutil.h"

#include <lvgl.h>
#include <stdio.h>
#include <string.h>

LV_FONT_DECLARE(font_latin_14)
LV_FONT_DECLARE(font_latin_16)
LV_FONT_DECLARE(font_latin_18)

static const char *FILTERS[] = {"Todos", "Radar", "Cartera", "Reddit", "Ideas", "En vivo"};
static const char *FILTER_ID[] = {"", "radar", "cartera", "reddit", "ideas", "live"};

static lv_obj_t *link_label = nullptr;
static lv_obj_t *unread_label = nullptr;
static lv_obj_t *clock_label = nullptr;
static lv_obj_t *filter_btns[6] = {};
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
  lv_chart_set_div_line_count(chart, 2, 0);
  lv_chart_set_axis_tick(chart, LV_CHART_AXIS_PRIMARY_Y, 0, 0, 0, 0, false, 0);
  lv_chart_set_axis_tick(chart, LV_CHART_AXIS_PRIMARY_X, 0, 0, 0, 0, false, 0);
}

static int32_t axis_t0 = 0;
static int32_t axis_t1 = 0;

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

static int text_px(const char *s) { return (int)strlen(s) * 8; }

static void on_price_draw(lv_event_t *e) {
  if (axis_t1 <= axis_t0) return;
  lv_draw_ctx_t *ctx = lv_event_get_draw_ctx(e);
  if (!ctx) return;
  lv_area_t a;
  lv_obj_get_coords(lv_event_get_target(e), &a);
  int width = (int)(a.x2 - a.x1);
  if (width < 8) return;
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
  for (; mark < local1; mark += 1800) {
    int x = (int)(a.x1 + (mark - local0) * width / span);
    if (x <= (int)a.x1 + 1 || x >= (int)a.x2 - 1) continue;
    lv_point_t p1 = {(lv_coord_t)x, (lv_coord_t)(a.y1 + 1)};
    lv_point_t p2 = {(lv_coord_t)x, (lv_coord_t)(a.y2 - 1)};
    lv_draw_line(ctx, &dsc, &p1, &p2);
  }
}

static void paint_times() {
  lv_obj_t *row = lv_obj_create(list);
  lv_obj_set_width(row, lv_pct(100));
  lv_obj_set_height(row, 16);
  lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(row, 0, 0);
  lv_obj_set_style_pad_all(row, 0, 0);
  lv_obj_clear_flag(row, LV_OBJ_FLAG_SCROLLABLE);
  if (axis_t1 <= axis_t0) return;
  const int width = SCREEN_W - 16;
  int64_t local0 = (int64_t)axis_t0 + (int64_t)TZ_OFFSET_MIN * 60;
  int64_t local1 = (int64_t)axis_t1 + (int64_t)TZ_OFFSET_MIN * 60;
  int64_t span = local1 - local0;
  if (span <= 0) return;
  char now[12];
  format_clock(axis_t1, now, sizeof now, true);
  int now_left = width - text_px(now);

  int64_t rem = ((local0 % 1800) + 1800) % 1800;
  int64_t mark = rem == 0 ? local0 : local0 + (1800 - rem);
  for (; mark < local1; mark += 1800) {
    char text[8];
    format_clock((int32_t)(mark - (int64_t)TZ_OFFSET_MIN * 60), text, sizeof text, false);
    int tw = text_px(text);
    int x = (int)((mark - local0) * width / span) - tw / 2;
    if (x < 0) x = 0;
    if (x + tw > now_left - 2) continue;
    lv_obj_t *lbl = lv_label_create(row);
    lv_label_set_text(lbl, text);
    lv_obj_set_style_text_font(lbl, &font_latin_14, 0);
    lv_obj_set_style_text_color(lbl, lv_color_hex(0x6E7464), 0);
    lv_obj_set_pos(lbl, x, 0);
  }
  lv_obj_t *live = lv_label_create(row);
  lv_label_set_text(live, now);
  lv_obj_set_style_text_font(live, &font_latin_14, 0);
  lv_obj_set_style_text_color(live, lv_color_hex(0xF2F0E6), 0);
  lv_obj_set_pos(live, now_left, 0);
}

static void paint_live(const TapeRow *q) {
  bool up = q->change[0] == '+';
  bool down = q->change[0] == '-';
  lv_color_t ink = up ? lv_color_hex(0x3DDC97) : down ? lv_color_hex(0xFF6B6B) : lv_color_hex(0xF2F0E6);

  lv_obj_t *head = lv_obj_create(list);
  lv_obj_set_width(head, lv_pct(100));
  lv_obj_set_height(head, q->level > 0 ? 52 : 36);
  lv_obj_set_style_bg_opa(head, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(head, 0, 0);
  lv_obj_set_style_pad_all(head, 0, 0);
  lv_obj_set_style_pad_row(head, 0, 0);
  lv_obj_set_flex_flow(head, LV_FLEX_FLOW_COLUMN);
  lv_obj_clear_flag(head, LV_OBJ_FLAG_SCROLLABLE);

  lv_obj_t *top = lv_obj_create(head);
  lv_obj_set_width(top, lv_pct(100));
  lv_obj_set_height(top, 28);
  lv_obj_set_style_bg_opa(top, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(top, 0, 0);
  lv_obj_set_style_pad_all(top, 0, 0);
  lv_obj_set_flex_flow(top, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(top, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_clear_flag(top, LV_OBJ_FLAG_SCROLLABLE);

  lv_obj_t *sym = lv_label_create(top);
  lv_label_set_text(sym, q->symbol);
  lv_obj_set_style_text_font(sym, &font_latin_18, 0);
  lv_obj_set_style_text_color(sym, lv_color_hex(0xF2F0E6), 0);

  char summary[48];
  snprintf(summary, sizeof summary, "%s  %s", q->price[0] ? q->price : "n/d", q->change[0] ? q->change : "—");
  lv_obj_t *px = lv_label_create(top);
  lv_label_set_text(px, summary);
  lv_obj_set_style_text_font(px, &font_latin_16, 0);
  lv_obj_set_style_text_color(px, ink, 0);

  char vol[24];
  snprintf(vol, sizeof vol, "vol %s", q->volume[0] ? q->volume : "n/d");
  lv_obj_t *vlab = lv_label_create(top);
  lv_label_set_text(vlab, vol);
  lv_obj_set_style_text_font(vlab, &font_latin_14, 0);
  lv_obj_set_style_text_color(vlab, lv_color_hex(0xE8D7A8), 0);

  if (q->level > 0) {
    float cur = 0;
    int best = -1;
    for (int i = 0; i < q->n; i++) {
      if ((int)q->slot[i] >= best) {
        best = q->slot[i];
        cur = q->px[i];
      }
    }
    float pct = (cur - q->level) / q->level * 100.f;
    char extra[40];
    snprintf(extra, sizeof extra, "nivel %.2f  %+.1f%%", q->level, pct);
    lv_obj_t *nl = lv_label_create(head);
    lv_label_set_text(nl, extra);
    lv_obj_set_style_text_font(nl, &font_latin_14, 0);
    lv_obj_set_style_text_color(nl, lv_color_hex(0xE0A100), 0);
  }

  if (q->n < 2) {
    lv_obj_t *empty = lv_label_create(list);
    lv_label_set_text(empty, "Sin curva todavía");
    lv_obj_set_style_text_color(empty, lv_color_hex(0x9AA392), 0);
    return;
  }

  float plo = q->px[0];
  float phi = q->px[0];
  float vhi = 0;
  for (int i = 0; i < q->n; i++) {
    if (q->px[i] < plo) plo = q->px[i];
    if (q->px[i] > phi) phi = q->px[i];
    if (q->vl[i] > vhi) vhi = q->vl[i];
  }
  if (q->level > 0) {
    if (q->level < plo) plo = q->level;
    if (q->level > phi) phi = q->level;
  }
  float span = phi - plo;
  if (!(span > 0)) span = plo > 0 ? plo * 0.01f : 1;
  plo -= span * 0.05f;
  phi += span * 0.05f;

  axis_t0 = q->t0;
  axis_t1 = q->t1 > q->t0 ? q->t1 : q->t0 + 8 * 3600;

  lv_obj_t *price = lv_chart_create(list);
  lv_obj_set_width(price, lv_pct(100));
  lv_obj_set_flex_grow(price, 1);
  lv_obj_set_height(price, 0);
  style_chart(price);
  lv_obj_add_event_cb(price, on_price_draw, LV_EVENT_DRAW_POST, nullptr);
  lv_chart_set_type(price, LV_CHART_TYPE_LINE);
  lv_chart_set_point_count(price, TAPE_SLOTS);
  lv_chart_set_range(price, LV_CHART_AXIS_PRIMARY_Y, 0, 1000);
  if (q->level > 0) {
    lv_chart_series_t *ls = lv_chart_add_series(price, lv_color_hex(0xE0A100), LV_CHART_AXIS_PRIMARY_Y);
    lv_chart_set_all_value(price, ls, scale_point(q->level, plo, phi));
  }
  lv_chart_series_t *ps = lv_chart_add_series(price, ink, LV_CHART_AXIS_PRIMARY_Y);
  lv_chart_set_all_value(price, ps, LV_CHART_POINT_NONE);
  for (int i = 0; i < q->n; i++) {
    lv_chart_set_value_by_id(price, ps, q->slot[i], scale_point(q->px[i], plo, phi));
  }
  paint_times();

  lv_obj_t *caption = lv_label_create(list);
  lv_label_set_text(caption, "Volumen de la sesión");
  lv_obj_set_style_text_font(caption, &font_latin_14, 0);
  lv_obj_set_style_text_color(caption, lv_color_hex(0x9AA392), 0);

  lv_obj_t *bars = lv_chart_create(list);
  lv_obj_set_width(bars, lv_pct(100));
  lv_obj_set_height(bars, 72);
  style_chart(bars);
  lv_chart_set_type(bars, LV_CHART_TYPE_BAR);
  lv_chart_set_point_count(bars, TAPE_SLOTS);
  lv_chart_set_range(bars, LV_CHART_AXIS_PRIMARY_Y, 0, 1000);
  lv_chart_series_t *vs = lv_chart_add_series(bars, lv_color_hex(0xE0A100), LV_CHART_AXIS_PRIMARY_Y);
  lv_chart_set_all_value(bars, vs, LV_CHART_POINT_NONE);
  for (int i = 0; i < q->n; i++) {
    if (!(q->vl[i] > 0)) continue;
    lv_chart_set_value_by_id(bars, vs, q->slot[i], scale_point(q->vl[i], 0, vhi));
  }
}

static void style_filters() {
  for (int i = 0; i < 6; i++) {
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
  lv_obj_set_style_pad_hor(bar, 10, 0);
  lv_obj_set_style_pad_ver(bar, 0, 0);
  lv_obj_set_flex_flow(bar, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(bar, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_clear_flag(bar, LV_OBJ_FLAG_SCROLLABLE);

  link_label = lv_label_create(bar);
  lv_obj_set_style_text_font(link_label, &font_latin_14, 0);
  lv_label_set_text(link_label, "sin teléfono");

  unread_label = lv_label_create(bar);
  lv_obj_set_style_text_font(unread_label, &font_latin_14, 0);
  lv_obj_set_style_text_color(unread_label, lv_color_hex(0xE8D7A8), 0);
  lv_label_set_text(unread_label, "");

  clock_label = lv_label_create(bar);
  lv_obj_set_style_text_font(clock_label, &font_latin_14, 0);
  lv_obj_set_style_text_color(clock_label, lv_color_hex(0x9AA392), 0);
  lv_label_set_text(clock_label, "--:--");

  lv_obj_t *filters = lv_obj_create(scr);
  lv_obj_set_size(filters, SCREEN_W, 40);
  lv_obj_align(filters, LV_ALIGN_TOP_MID, 0, 36);
  lv_obj_set_style_bg_color(filters, lv_color_hex(0x12140F), 0);
  lv_obj_set_style_border_width(filters, 0, 0);
  lv_obj_set_style_pad_all(filters, 4, 0);
  lv_obj_set_style_pad_column(filters, 4, 0);
  lv_obj_set_flex_flow(filters, LV_FLEX_FLOW_ROW);
  lv_obj_clear_flag(filters, LV_OBJ_FLAG_SCROLLABLE);

  for (int i = 0; i < 6; i++) {
    lv_obj_t *btn = lv_btn_create(filters);
    lv_obj_set_flex_grow(btn, 1);
    lv_obj_set_height(btn, 32);
    lv_obj_set_style_radius(btn, 14, 0);
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

  list = lv_obj_create(scr);
  lv_obj_set_size(list, SCREEN_W, SCREEN_H - 76);
  lv_obj_align(list, LV_ALIGN_TOP_MID, 0, 76);
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

void ui_reload() { dirty = true; }

void ui_set_link(bool online) {
  link_on = online;
  if (!link_label) return;
  lv_label_set_text(link_label, online ? "en línea" : "sin teléfono");
  lv_obj_set_style_text_color(link_label, online ? lv_color_hex(0x3DDC97) : lv_color_hex(0x9AA392), 0);
}

void ui_pump() {
  if (dirty) rebuild();
}
