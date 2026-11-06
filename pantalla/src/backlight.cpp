#include "backlight.h"

#include "config.h"

#include <Arduino.h>
#include <Preferences.h>

static int duty = BL_AWAKE_DUTY;
static int sleep_duty = BL_SLEEP_DUTY;
static int mode = 0;
static bool asleep = false;
static bool hold = false;
static uint32_t last_activity = 0;
static uint32_t measure_until = 0;

static void clamp_sleep() {
  if (sleep_duty < 12) sleep_duty = 12;
  if (sleep_duty > 120) sleep_duty = 120;
  if (mode < 0 || mode > 2) mode = 0;
}

static void load_prefs() {
  Preferences prefs;
  if (!prefs.begin("pantalla", true)) return;
  sleep_duty = prefs.getInt("blduty", BL_SLEEP_DUTY);
  mode = prefs.getInt("blmode", 0);
  prefs.end();
  clamp_sleep();
}

static void save_prefs() {
  Preferences prefs;
  if (!prefs.begin("pantalla", false)) return;
  prefs.putInt("blduty", sleep_duty);
  prefs.putInt("blmode", mode);
  prefs.end();
}

static void apply(int next) {
  duty = next;
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  ledcWrite(PIN_BL, duty);
#else
  ledcWrite(0, duty);
#endif
}

static void follow_mode() {
  if (mode == 1) {
    asleep = false;
    apply(BL_AWAKE_DUTY);
    return;
  }
  if (mode == 2) {
    asleep = true;
    apply(sleep_duty);
    return;
  }
  asleep = false;
  last_activity = millis();
  apply(BL_AWAKE_DUTY);
}

void backlight_begin() {
  pinMode(PIN_BL, OUTPUT);
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  ledcAttach(PIN_BL, 5000, 8);
#else
  ledcSetup(0, 5000, 8);
  ledcAttachPin(PIN_BL, 0);
#endif
  load_prefs();
  last_activity = millis();
  asleep = mode == 2;
  apply(asleep ? sleep_duty : BL_AWAKE_DUTY);
}

void backlight_activity() {
  if (hold || millis() < measure_until) return;
  last_activity = millis();
  if (mode == 2) {
    asleep = true;
    if (duty != sleep_duty) apply(sleep_duty);
    return;
  }
  if (asleep || duty != BL_AWAKE_DUTY) {
    asleep = false;
    apply(BL_AWAKE_DUTY);
  }
}

void backlight_tick() {
  if (hold) return;
  uint32_t now = millis();
  if (now < measure_until) return;
  if (measure_until && now >= measure_until) {
    measure_until = 0;
    follow_mode();
    Serial.println("[luz] medicion terminada, pantalla despierta");
    return;
  }
  if (mode == 1) {
    asleep = false;
    if (duty != BL_AWAKE_DUTY) apply(BL_AWAKE_DUTY);
    return;
  }
  if (mode == 2) {
    asleep = true;
    if (duty != sleep_duty) apply(sleep_duty);
    return;
  }
  if (!asleep && now - last_activity >= SLEEP_MS) {
    asleep = true;
    apply(sleep_duty);
  }
}

void backlight_force_wake() {
  hold = false;
  measure_until = 0;
  asleep = false;
  last_activity = millis();
  apply(BL_AWAKE_DUTY);
}

void backlight_force_dim() {
  hold = false;
  measure_until = 0;
  asleep = true;
  apply(sleep_duty);
}

void backlight_set_sleep(int next) {
  sleep_duty = next;
  clamp_sleep();
  save_prefs();
  if (hold || mode == 2 || asleep) apply(sleep_duty);
}

void backlight_cycle_mode() {
  mode = (mode + 1) % 3;
  save_prefs();
  if (!hold) follow_mode();
}

void backlight_hold(bool on) {
  hold = on;
  if (on) {
    apply(sleep_duty);
    return;
  }
  follow_mode();
}

int backlight_sleep_duty() { return sleep_duty; }

int backlight_mode() { return mode; }

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
