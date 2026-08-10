/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Replace the stock builder's final six-byte BLE-MAC suffix copy with the
 * final six characters of the validated pair serial.  The stock copy always
 * runs first, so unknown layouts and invalid serials remain byte-for-byte
 * stock.
 */

typedef __UINTPTR_TYPE__ cfw_adv_name_uintptr;

typedef void (*cfw_adv_name_memcpy_function)(
    void *destination,
    const void *source,
    unsigned int length
);

#ifndef CFW_ADV_NAME_STOCK_MEMCPY_ADDRESS
#define CFW_ADV_NAME_STOCK_MEMCPY_ADDRESS 0x00439BE5U
#endif

#ifndef CFW_ADV_NAME_SERIAL_RECORD_POINTER_ADDRESS
#define CFW_ADV_NAME_SERIAL_RECORD_POINTER_ADDRESS 0x2000383CU
#endif

#ifndef CFW_ADV_NAME_STOCK_MEMCPY
#define CFW_ADV_NAME_STOCK_MEMCPY(destination, source, length) \
    (((cfw_adv_name_memcpy_function) \
        (cfw_adv_name_uintptr)CFW_ADV_NAME_STOCK_MEMCPY_ADDRESS)( \
            (destination), (source), (length) \
        ))
#endif

#ifndef CFW_ADV_NAME_SERIAL_RECORD_POINTER
#define CFW_ADV_NAME_SERIAL_RECORD_POINTER \
    ((const unsigned char *volatile *) \
        (cfw_adv_name_uintptr)CFW_ADV_NAME_SERIAL_RECORD_POINTER_ADDRESS)
#endif

#define CFW_ADV_NAME_SERIAL_LENGTH 14U
#define CFW_ADV_NAME_SUFFIX_LENGTH 6U

static __attribute__((always_inline)) inline unsigned int
cfw_adv_name_is_serial_character(unsigned char value)
{
    return (value >= (unsigned char)'0' && value <= (unsigned char)'9')
        || (value >= (unsigned char)'A' && value <= (unsigned char)'Z')
        || (value >= (unsigned char)'a' && value <= (unsigned char)'z');
}

__attribute__((used, noinline))
void cfw_copy_advertised_name_pair_suffix(
    unsigned char *destination,
    const unsigned char *stock_suffix,
    unsigned int length
)
{
    const unsigned char *serial_record;
    const unsigned char *serial;
    unsigned int index;

    CFW_ADV_NAME_STOCK_MEMCPY(destination, stock_suffix, length);

    if (destination == (unsigned char *)0
        || length != CFW_ADV_NAME_SUFFIX_LENGTH) {
        return;
    }
    serial_record = *CFW_ADV_NAME_SERIAL_RECORD_POINTER;
    if (serial_record == (const unsigned char *)0) {
        return;
    }
    serial = serial_record + 1U;
    for (index = 0U; index < CFW_ADV_NAME_SERIAL_LENGTH; ++index) {
        if (!cfw_adv_name_is_serial_character(serial[index])) {
            return;
        }
    }
    if (serial[CFW_ADV_NAME_SERIAL_LENGTH] != 0U) {
        return;
    }
    for (index = 0U; index < CFW_ADV_NAME_SUFFIX_LENGTH; ++index) {
        destination[index] = serial[
            CFW_ADV_NAME_SERIAL_LENGTH
            - CFW_ADV_NAME_SUFFIX_LENGTH
            + index
        ];
    }
}

#undef CFW_ADV_NAME_SUFFIX_LENGTH
#undef CFW_ADV_NAME_SERIAL_LENGTH
#undef CFW_ADV_NAME_SERIAL_RECORD_POINTER
#undef CFW_ADV_NAME_STOCK_MEMCPY
#undef CFW_ADV_NAME_SERIAL_RECORD_POINTER_ADDRESS
#undef CFW_ADV_NAME_STOCK_MEMCPY_ADDRESS
