#pragma once

enum class BattState { Absent, Charging, Discharging };

struct BattSample {
  BattState state;
  int pct;
  float volts;
};

BattSample battery_read();
