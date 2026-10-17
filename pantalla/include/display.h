#pragma once

#include <stdint.h>

bool display_begin();
void display_color_bars();
void display_touch_log(uint32_t ms);
void display_pump();
