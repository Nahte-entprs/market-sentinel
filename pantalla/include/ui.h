#pragma once

#include <stdint.h>

void ui_init();
void ui_reload();
void ui_note_quote();
void ui_set_link(bool online);
void ui_set_clock(int32_t unix_sec);
void ui_pump();
