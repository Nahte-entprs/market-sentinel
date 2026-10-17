#pragma once

#include <stdint.h>

void backlight_begin();
void backlight_activity();
void backlight_tick();
void backlight_force_wake();
void backlight_force_dim();
void backlight_measure();
bool backlight_asleep();
int backlight_duty();
