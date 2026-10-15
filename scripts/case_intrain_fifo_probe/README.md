# Fixed passive in-train FIFO research probe

Isolated derivative of the qualified early-recovery bridge. Despite the retained
build argument `early-hello`, this program transmits **zero UART bytes**.
USART3 hardware FIFO receives while the exact103-action stock reset train runs.
CPU reads occur only afterward. No DMA or receive interrupts. Pinmode and FIFO
readback gates fail closed. All ten YHM baseline bytes are compared after restore.
No flash, INFO or charging-protection override interface exists.

15 compiled-model cases passed, including arrival during the train and simulated
overflow. Software waveform comparison is not oscilloscope timing evidence.
Stock OVRDIS is retained: missing overrun flags cannot prove complete reception.
The bounded FIFO has no byte timestamps and may retain only a stream prefix.

Mac capture: one00 byte, framing error0x2, no valid recovery endpoint, zeroTX,
exact YHM restoration, normal Case1.2.57 restored. See
`docs/case-intrain-passive-fifo-probe-2026-10-14.json` and its referenced receipts.
