ENTRY(sbl_writer_request_allowed)
SECTIONS
{
  . = 0x20010380;
  .text : { KEEP(*(.text.sbl_writer_request_allowed)) *(.text*) *(.rodata*) }
  /DISCARD/ : { *(.ARM.exidx*) *(.comment*) *(.note*) }
}
ASSERT(SIZEOF(.text) <= 0x10a, "schema-13 validator exceeds original slot")
