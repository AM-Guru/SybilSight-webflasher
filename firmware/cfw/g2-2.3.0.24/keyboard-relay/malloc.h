#pragma once
#include <stdint.h>
#define FW_MALLOC ((void *(*)(uint32_t))0x0045855fu)
#define FW_FREE ((void (*)(void *))0x004585a3u)
static void *cfw_malloc(uint32_t size);
