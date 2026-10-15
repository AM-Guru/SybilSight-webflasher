.syntax unified
.cpu cortex-m0plus
.thumb
.section .vectors,"a",%progbits
.word 0x20014000
.word _start
.rept 13
.word fault_stop
.endr
.word tick_handler
.section .text.start,"ax",%progbits
.global _start
.thumb_func
_start:
 cpsid i
 bl bridge_main
1: b 1b
.global fault_stop
.thumb_func
fault_stop:
 cpsid i
1: b 1b
