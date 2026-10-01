#pragma once
#include <stdint.h>

/* A separate sidecar, not a new layout for the preserved .84 microphone context.
 * .84 reserves [0x2029f59c, 0x2029f8a8) from TLSF: context @+0, allocation
 * diagnostic @+4, dashboard's 12-byte snapshot @+8. Keyboard owns the next word.
 * The chained heap-startup hook clears it before old allocations can be reused. */
#define KEYBOARD_CONTEXT_SLOT 0x2029f5b0u
typedef struct { void *keyboard; } customCfwContext;
static customCfwContext *getCustomCfwContext(void) {
    return (customCfwContext *)(uintptr_t)KEYBOARD_CONTEXT_SLOT;
}
static customCfwContext *peekCustomCfwContext(void) { return getCustomCfwContext(); }
#define CFW_FN_ADDR(fn) ((void *)&(fn))
#define FW_MS_TICK (*(volatile uint32_t *)0x20077e4cu)
#define FW_SIDE_ID ((uint32_t (*)(void))0x00465d4du)
#define FW_TIMER_NEW ((uint32_t (*)(void *, uint32_t, void *, void *))0x00442b65u)
#define FW_TIMER_START ((int32_t (*)(uint32_t, uint32_t))0x00442c4du)
#define FW_TIMER_DELETE ((int32_t (*)(uint32_t))0x00442cf3u)
typedef int (*send_fn)(int, int, unsigned char *, unsigned);
#define FW_NOTIFY_SEND 0x0047f025u
