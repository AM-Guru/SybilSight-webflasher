#include <stdint.h>

#ifndef STOCK_BYTES
#error STOCK_BYTES must be pinned by the builder
#endif
#ifndef STOCK_CRC32
#error STOCK_CRC32 must be pinned by the builder
#endif
#define MAX_REQUEST_BYTES 1009u

static uint32_t crc32(const uint8_t *p, uint32_t n)
{
    uint32_t crc = 0xffffffffu;
    while (n-- != 0u) {
        crc ^= *p++;
        for (uint32_t bit = 0u; bit < 8u; ++bit) {
            uint32_t mask = 0u - (crc & 1u);
            crc = (crc >> 1) ^ (0xedb88320u & mask);
        }
    }
    return ~crc;
}

uint32_t sbl_writer_request_allowed(const uint8_t *request, uint32_t length)
{
    const uint32_t *words = (const uint32_t *)(const void *)request;
    uint32_t header, type, sequence, payload, shape;

    if (length < 8u || length > MAX_REQUEST_BYTES) {
        return 1u;
    }
    header = words[1];
    if ((header >> 16) != length) {
        return 1u;
    }
    type = header & 0xffffu;
    shape = 0u;
    if (length == 8u) {
        shape = type == 0u;
    } else if (length == 12u) {
        shape = (type == 2u && words[2] == 0x007fe000u) ||
                (type == 6u && words[2] == 1u);
    } else if (length == 20u) {
        shape = type == 3u && words[2] == STOCK_BYTES &&
                words[3] == STOCK_CRC32 && words[4] == 0u;
    } else if (type == 8u && length >= 13u) {
        sequence = words[2];
        payload = length - 12u;
        shape = sequence < STOCK_BYTES && payload <= STOCK_BYTES - sequence;
    }
    return shape == 0u || crc32(request + 4u, length - 4u) != words[0];
}
