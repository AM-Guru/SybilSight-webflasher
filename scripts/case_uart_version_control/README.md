# Fixed pogo version control

This custom case SRAM payload tests the same native TX/RX direction helpers
and polled UART register path as the SBL discovery payload. It sends **one
five-byte version query**, with no temple reset, firmware upload, arbitrary
command interpreter or image writer.

- Left pogo request: `24 00 00 00 a6`.
- Right pogo request: `24 00 01 00 a7`.
- These are the command bodies, not the nine-byte USB case-console frames.
- A response qualifies only with the expected 14-byte version frame and sum8.
- UART is fixed at nominal 1 Mbaud; capture is bounded to 400 nominal ms.
- Retained results bind readiness, route, counters, raw RX, exact ten-register
  YHM restoration and PB8/PB9/gate field and output-latch restoration.
- Live execution requires fresh exact stock case identity, inactive OTA, two
  complete live code matches and verified writes to reserved SRAM.

Build from the webflasher root:

```sh
python scripts/case_uart_version_control/build.py \
  --route left --output work/version-control/left
python scripts/case_uart_version_control/run.py inspect-build \
  --build work/version-control/left
```

To execute, use `run.py probe` with the same device, exact case serial,
case-reference and bridge-SHA arguments as the reset probe, plus
`--execute-fixed-version-query` and a fresh `.json` output path. This is intended
first for a freshly confirmed responsive secondary temple. A silent original
temple cannot provide a positive receive-path control.

Schema 5 supports native-turnaround and early-armed RX modes. Early RX waits
for TEACK/REACK before TX and keeps RE enabled through turnaround. Both modes
enable and verify overrun reporting with UE disabled. The native variants each
pass 27 compiled fault cases; early variants each pass 28 (110 total).
The emulator's `scripts/probe-usb-version-control.py` adds 18 timed application
response scenarios, including two exchanges of fixture bytes through Renode UART.
The fixture version 9.8.7.6/HW5 is synthetic. Native stock `comm_read` separately
confirms the five-byte request boundary; the experiment and source provenance
are described in `docs/g2-wired-recovery-goal.md`.

A left early-armed live test captured exactly the five request bytes, with no
valid application version. This is transmit-echo-compatible evidence, not a
positive temple receive control. Readiness, overrun configuration and exact
restoration verified; the case returned to stock 1.2.57. Audit:
`work/usb-stock-recovery-20261104/goal/early-rx-hardware-20261105T032008Z/`.
The currently seated pair was unconfirmed; the last operator confirmation was
the original pair. Secondary-pair confirmation remains pending.
Existing SBL/reset payload builds and their source hashes remain unchanged.
