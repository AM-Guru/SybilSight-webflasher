ENTRY(trampoline)
SECTIONS {
 . = 0x0800d9d0;
 .text : { KEEP(*(.text.entry)) *(.text*) *(.rodata*) }
 .data : { *(.data*) }
 .bss : { *(.bss*) *(COMMON) }
 /DISCARD/ : { *(.ARM.exidx*) *(.ARM.extab*) *(.comment*) }
 ASSERT(. <= 0x0800e000,"trampoline exceeds candidate tail")
 ASSERT(SIZEOF(.data)==0 && SIZEOF(.bss)==0,"no implicit runtime data")
}
