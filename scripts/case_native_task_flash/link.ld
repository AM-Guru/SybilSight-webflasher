ENTRY(_start)
SECTIONS {
 . = 0x20010000;
 .vectors : { KEEP(*(.vectors)) }
 .text : { *(.text.start) *(.text*) *(.rodata*) }
 .data : { *(.data*) }
 .bss : { *(.bss*) *(COMMON) }
 /DISCARD/ : { *(.ARM.exidx*) *(.ARM.extab*) *(.comment*) }
 ASSERT(. < 0x20013800,"writer overlaps evidence")
 ASSERT(SIZEOF(.data)==0 && SIZEOF(.bss)==0,"no implicit runtime state")
}
