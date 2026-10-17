#pragma once

#include <stddef.h>
#include <stdint.h>

void ble_begin();
bool ble_connected();
bool ble_take_line(char *out, size_t cap);
void ble_ack(const char *text);
