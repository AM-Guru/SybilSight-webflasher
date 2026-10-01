/* GPL-3.0: additive keyboard relay for the exact SybilSight/230.84 parent.
 * Keep the old blob and all of its display/microphone hooks. Rechain only the
 * settings decoder and heap-reset wrapper; add the five upstream keyboard hooks. */
#include "cfw_context.h"
#include "malloc.h"
#include "parent_hooks.h"
#include "memory.c"
#include "protobuf.c"
static void *cfw_malloc(uint32_t size) { return FW_MALLOC(size); }
#include "keyboard.c"

static int keyboard_read_varint(const uint8_t **cursor, const uint8_t *end, uint32_t *out) {
    uint32_t value = 0;
    for (unsigned shift = 0; shift <= 28 && *cursor < end; shift += 7) {
        uint8_t byte = *(*cursor)++;
        if (shift == 28 && (byte & 0xf0)) return 0;
        value |= (uint32_t)(byte & 127) << shift;
        if (!(byte & 128)) { *out = value; return 1; }
    }
    return 0;
}

static void keyboard_scan_settings(const uint8_t *p, uint32_t length) {
    const uint8_t *end = p + length;
    while (p < end) {
        uint32_t tag, size;
        if (!keyboard_read_varint(&p, end, &tag) || !(tag >> 3)) return;
        switch (tag & 7) {
        case 0: if (!keyboard_read_varint(&p, end, &size)) return; break;
        case 1: if (end - p < 8) return; p += 8; break;
        case 2:
            if (!keyboard_read_varint(&p, end, &size) || size > (uint32_t)(end - p)) return;
            if (tag >> 3 == 130) keyboard_apply_control(p, size);
            p += size;
            break;
        case 5: if (end - p < 4) return; p += 4; break;
        default: return;
        }
    }
}

int keyboard_settings_decode(void *stream, const void *fields, void *dest) {
    /* nanopb's original stream is {callback, state, bytes_left, errmsg}. Scan
     * before the inherited decoder advances it; old custom controls still run. */
    const uint32_t *words = stream;
    if (words && words[1] && words[2])
        keyboard_scan_settings((const uint8_t *)(uintptr_t)words[1], words[2]);
    return ((int (*)(void *, const void *, void *))PARENT_SETTINGS_DECODE)(stream, fields, dest);
}

void keyboard_heap_startup(void) {
    __atomic_store_n((void **)KEYBOARD_CONTEXT_SLOT, 0, __ATOMIC_RELEASE);
    ((void (*)(void))PARENT_HEAP_RESET)();
}
