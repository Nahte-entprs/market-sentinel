#pragma once

#include <stdint.h>

void backlight_begin();
void backlight_activity();
void backlight_tick();
void backlight_force_wake();
void backlight_force_dim();
void backlight_measure();
void backlight_set_sleep(int duty);
void backlight_cycle_mode();
void backlight_hold(bool on);
int backlight_sleep_duty();
int backlight_mode();
bool backlight_asleep();
int backlight_duty();
