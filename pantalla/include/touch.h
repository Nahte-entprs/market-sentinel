#pragma once

void touch_begin();
void touch_scan_i2c();
bool touch_read(int &x, int &y);
