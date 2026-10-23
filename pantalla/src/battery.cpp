#include "battery.h"

#include <Arduino.h>

// JC3248W535C: divisor de la batería en GPIO 5. La comunidad que usa
// esta placa mide el pin y multiplica por 1.72 para llegar a voltios.
static constexpr int PIN_BAT = 5;
static constexpr float DIVIDER = 1.72f;

BattSample battery_read() {
  analogSetPinAttenuation(PIN_BAT, ADC_11db);
  uint32_t acc = 0;
  for (int i = 0; i < 8; i++) acc += analogReadMilliVolts(PIN_BAT);
  float volts = (acc / 8.0f) / 1000.f * DIVIDER;
  BattSample sample;
  sample.volts = volts;
  sample.pct = 0;
  if (volts < 2.8f) {
    sample.state = BattState::Absent;
    return sample;
  }
  if (volts >= 4.28f) {
    sample.state = BattState::Charging;
    sample.pct = 100;
    return sample;
  }
  float pct = (volts - 3.30f) / (4.15f - 3.30f) * 100.f;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  sample.pct = (int)(pct + 0.5f);
  sample.state = BattState::Discharging;
  return sample;
}
