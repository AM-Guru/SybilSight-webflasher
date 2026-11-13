ENTRY(hook_main)
SECTIONS {
 . = 0x20010000;
 .text : { KEEP(*(.text.entry)) *(.text*) *(.rodata*) }
 .data : { *(.data*) }
 .bss : { *(.bss*) *(COMMON) }
 /DISCARD/ : { *(.ARM.exidx*) *(.ARM.extab*) *(.comment*) }
 ASSERT(. < 0x20011800,"hook overlaps evidence")
 ASSERT(SIZEOF(.data)==0 && SIZEOF(.bss)==0,"no implicit runtime data")
}
