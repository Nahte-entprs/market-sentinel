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

static void paint_quote(const TapeRow *q) {
  lv_obj_t *card = lv_obj_create(list);
  lv_obj_set_width(card, lv_pct(100));
  lv_obj_set_height(card, LV_SIZE_CONTENT);
  lv_obj_set_style_bg_color(card, lv_color_hex(0x1C2118), 0);
  lv_obj_set_style_radius(card, 10, 0);
  lv_obj_set_style_pad_all(card, 8, 0);
  lv_obj_set_style_pad_left(card, 12, 0);
  lv_obj_set_style_border_side(card, LV_BORDER_SIDE_LEFT, 0);
  lv_obj_set_style_border_width(card, 4, 0);
  lv_obj_set_style_border_color(card, lv_color_hex(0xCE93D8), 0);
  lv_obj_set_flex_flow(card, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(card, 2, 0);
  lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);

  lv_obj_t *row = lv_obj_create(card);
  lv_obj_set_width(row, lv_pct(100));
  lv_obj_set_height(row, LV_SIZE_CONTENT);
  lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(row, 0, 0);
  lv_obj_set_style_pad_all(row, 0, 0);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(row, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_clear_flag(row, LV_OBJ_FLAG_SCROLLABLE);

  lv_obj_t *sym = lv_label_create(row);
  lv_label_set_text(sym, q->symbol);
  lv_obj_set_style_text_font(sym, &font_latin_18, 0);
  lv_obj_set_style_text_color(sym, lv_color_hex(0xF2F0E6), 0);

  lv_obj_t *px = lv_label_create(row);
  lv_label_set_text(px, q->price[0] ? q->price : "n/d");
  lv_obj_set_style_text_font(px, &font_latin_18, 0);

  lv_obj_t *meta = lv_obj_create(card);
  lv_obj_set_width(meta, lv_pct(100));
  lv_obj_set_height(meta, LV_SIZE_CONTENT);
  lv_obj_set_style_bg_opa(meta, LV_OPA_TRANSP, 0);
  lv_obj_set_style_border_width(meta, 0, 0);
  lv_obj_set_style_pad_all(meta, 0, 0);
  lv_obj_set_flex_flow(meta, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(meta, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_clear_flag(meta, LV_OBJ_FLAG_SCROLLABLE);

  bool up = q->change[0] == '+';
  bool down = q->change[0] == '-';
  lv_obj_t *chg = lv_label_create(meta);
  lv_label_set_text(chg, q->change[0] ? q->change : "—");
  lv_obj_set_style_text_font(chg, &font_latin_14, 0);
  lv_obj_set_style_text_color(chg, up ? lv_color_hex(0x3DDC97) : down ? lv_color_hex(0xFF6B6B) : lv_color_hex(0x9AA392), 0);

  char vol[24];
  snprintf(vol, sizeof vol, "vol %s", q->volume[0] ? q->volume : "n/d");
  lv_obj_t *v = lv_label_create(meta);
  lv_label_set_text(v, vol);
  lv_obj_set_style_text_font(v, &font_latin_14, 0);
  lv_obj_set_style_text_color(v, lv_color_hex(0xE8D7A8), 0);
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
    if (!tape_count()) {
      lv_obj_t *empty = lv_label_create(list);
      lv_label_set_text(empty, "Nada en tiempo real");
      lv_obj_set_style_text_color(empty, lv_color_hex(0x9AA392), 0);
    } else {
      for (int i = 0; i < tape_count(); i++) paint_quote(tape_at(i));
    }
    int unread = store_unread();
    if (unread_label) lv_label_set_text_fmt(unread_label, unread ? "%d" : "al día", unread);
    if (detail_open) lv_obj_move_foreground(detail);
    dirty = false;
    return;
  }
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
