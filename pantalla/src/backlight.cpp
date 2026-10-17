#include "backlight.h"

#include "config.h"

#include <Arduino.h>

static int duty = BL_AWAKE_DUTY;
static bool asleep = false;
static uint32_t last_activity = 0;
static uint32_t measure_until = 0;

static void apply(int next) {
  duty = next;
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  ledcWrite(PIN_BL, duty);
#else
  ledcWrite(0, duty);
#endif
}

void backlight_begin() {
  pinMode(PIN_BL, OUTPUT);
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  ledcAttach(PIN_BL, 5000, 8);
#else
  ledcSetup(0, 5000, 8);
  ledcAttachPin(PIN_BL, 0);
#endif
  last_activity = millis();
  asleep = false;
  apply(BL_AWAKE_DUTY);
}

void backlight_activity() {
  if (millis() < measure_until) return;
  last_activity = millis();
  if (asleep || duty != BL_AWAKE_DUTY) {
    asleep = false;
    apply(BL_AWAKE_DUTY);
  }
}

void backlight_tick() {
  uint32_t now = millis();
  if (now < measure_until) return;
  if (measure_until && now >= measure_until) {
    measure_until = 0;
    asleep = false;
    last_activity = now;
    apply(BL_AWAKE_DUTY);
    Serial.println("[luz] medicion terminada, pantalla despierta");
    return;
  }
  if (!asleep && now - last_activity >= SLEEP_MS) {
    asleep = true;
    apply(BL_SLEEP_DUTY);
  }
}

void backlight_force_wake() {
  measure_until = 0;
  asleep = false;
  last_activity = millis();
  apply(BL_AWAKE_DUTY);
}

void backlight_force_dim() {
  measure_until = 0;
  asleep = true;
  apply(BL_SLEEP_DUTY);
}

void backlight_measure() {
  measure_until = millis() + MEASURE_MS;
  asleep = true;
  apply(BL_SLEEP_DUTY);
  Serial.println("[luz] medicion 30s con retroiluminacion al minimo (no a cero).");
  Serial.println("[luz] Mide la corriente entre la bateria y la placa. No toques la pantalla.");
  Serial.printf("[luz] duty %d/255. Si la placa se apaga sola, sube BL_SLEEP_DUTY en config.h.\n", BL_SLEEP_DUTY);
  Serial.println("[luz] Referencia del fabricante: pantalla encendida unos 150-400 mA.");
  Serial.printf("[luz] Sueno automatico a los %d s de inactividad.\n", SLEEP_MS / 1000);
}

bool backlight_asleep() { return asleep; }
int backlight_duty() { return duty; }
