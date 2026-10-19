#pragma once

#include <esp_heap_caps.h>
#include <stddef.h>

static inline void *lv_psram_pool(size_t size) {
  return heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
}
