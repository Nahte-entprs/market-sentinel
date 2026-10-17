#include "touch.h"

#include "config.h"

#include <Arduino.h>
#include <Wire.h>

void touch_begin() {
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
}

void touch_scan_i2c() {
  Serial.print("[i2c]");
  int found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf(" 0x%02X", addr);
      found++;
    }
  }
  if (!found) Serial.print(" (vacio)");
  Serial.println();
}

bool touch_read(int &x, int &y) {
  const uint8_t cmd[8] = {0xb5, 0xab, 0xa5, 0x5a, 0x00, 0x00, 0x00, 0x08};
  Wire.beginTransmission(TOUCH_ADDR);
  Wire.write(cmd, sizeof cmd);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom(TOUCH_ADDR, 8) != 8) return false;
  uint8_t data[8];
  for (int i = 0; i < 8; i++) data[i] = Wire.read();
  if (data[1] == 0 || data[1] > 5) return false;
  int raw_x = ((data[2] & 0x0F) << 8) | data[3];
  int raw_y = ((data[4] & 0x0F) << 8) | data[5];
  if (raw_x > 600 || raw_y > 600) return false;
  x = raw_x;
  y = raw_y;
#if TOUCH_SWAP_XY
  int swap = x;
  x = y;
  y = swap;
#endif
#if TOUCH_MIRROR_X
  x = PANEL_W - 1 - x;
#endif
#if TOUCH_MIRROR_Y
  y = PANEL_H - 1 - y;
#endif
#if DISPLAY_ROTATION == 1
  {
    int lx = (PANEL_H - 1) - y;
    int ly = x;
    x = lx;
    y = ly;
  }
#elif DISPLAY_ROTATION == 3
  {
    int lx = y;
    int ly = (PANEL_W - 1) - x;
    x = lx;
    y = ly;
  }
#elif DISPLAY_ROTATION == 2
  x = PANEL_W - 1 - x;
  y = PANEL_H - 1 - y;
#endif
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x >= SCREEN_W) x = SCREEN_W - 1;
  if (y >= SCREEN_H) y = SCREEN_H - 1;
  return true;
}
