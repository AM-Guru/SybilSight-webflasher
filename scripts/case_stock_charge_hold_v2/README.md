# Fixed stock-output hold research

This Case SRAM program preserves a qualified settled AF/AF YHM baseline for120
one-second intervals, with10-register readback each second. It makes zero YHM
writes, sends zero temple UART bytes, and emits no pogo reset train. Stock Case
sensing and communications are paused. It is not a battery-current measurement.

The stock periodic watchdog helper08002CB8 is executed every5seconds. Native
model execution traces onlyPB2 mask4 transitions, neverPB9, and forbids all bus
writes. Six compiled/native cases pass. Faults request immediate normal Case
reset after recording results. The host always restores and verifies Case1.2.57.

The original version stopped after18 iterations with no completion marker;
its runner is disabled. External watchdog reset is consistent with this, not
independently established by a reset-cause record. V2 completed120 iterations
on the Mac pair, all10 bytes unchanged. Right remained silent afterward.
