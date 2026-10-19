#pragma once

#include "notice.h"

enum class AddResult { Ok, Duplicate, Error };

bool store_begin();
// Deja solo avisos de los últimos NOTICE_KEEP_SEC. now_epoch 0 usa la marca más nueva ya guardada.
bool store_prune(int64_t now_epoch);
AddResult store_add(const NoticeDraft &draft);
bool store_mark_read(uint32_t id);
int store_count();
int store_unread();
const Notice *store_at(int index);
const Notice *store_find(uint32_t id);
