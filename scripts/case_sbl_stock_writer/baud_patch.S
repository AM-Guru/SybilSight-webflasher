.syntax unified
.thumb

#ifndef UART_BRR
#error UART_BRR is required
#endif

.section .text.baud_patch, "ax", %progbits
.global baud_patch
.type baud_patch, %function
.thumb_func
baud_patch:
    push {r4, lr}
    blx r3
    cpsid i
    ldr r0, uart_brr_address
    ldr r1, uart_brr_value
    str r1, [r0]
    pop {r4, pc}
    .align 2
uart_brr_address:
    .word 0x4000480c
uart_brr_value:
    .word UART_BRR
.size baud_patch, . - baud_patch
