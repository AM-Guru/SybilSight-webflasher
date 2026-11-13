ENTRY(baud_patch)
MEMORY
{
    SRAM_PATCH (rx) : ORIGIN = 0x2001067c, LENGTH = 0x44
}
SECTIONS
{
    .text :
    {
        KEEP(*(.text.baud_patch))
        *(.text*)
        *(.rodata*)
    } > SRAM_PATCH
    /DISCARD/ : { *(.comment*) *(.note*) }
}
ASSERT(SIZEOF(.text) <= LENGTH(SRAM_PATCH), "baud patch exceeds reviewed NOP cave")
