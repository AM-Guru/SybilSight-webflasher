# Stock reset with early-armed HELLO reception

This separate schema-7 SRAM prototype combines the pinned stock 1.2.57 PB9
reset train with early-armed reception. Historical schema-3 reset sources and
builds are preserved. It sends only fixed eight-byte HELLO; there is no temple
image writer, provisioning write or case-flash replacement.

The stock_reset function is unchanged from the historical prototype. The native
trace extractor pins complete case code and supplies exactly 103 actions and
62 nominal delay ticks. Emitted-code validation checks every action in order,
all masks/values and full completion before permitting HELLO. The native busy
loops execute stock code on hardware; timing and Apollo reset delivery remain
unmeasured. RX is unavailable during the train.

After release, native UART TX setup runs once. The probe then disables UE,
clears/verifies OVRDIS, enables RX and checks TEACK/REACK before transmitting.
RE remains enabled during TX, turnaround and between requests. No RX flush or
native UART reinitialization occurs after HELLO starts. At most 20 HELLOs are
sent with 400 nominal ms capture each. External-watchdog service between
attempts 8 and 16 creates CPU polling gaps; detected UART overruns fail closed.

A complete CRC32-valid 96-byte type-1 STATUS is required. Echo, unknown reset
coupling and synthetic model entry never authorize a firmware transfer.
Retained RST7 evidence binds native action hash/count/ticks, early ACK, overrun
configuration, RX counters/tail and exact YHM/GPIO/latch restoration. READY
G2R7 declares configuration before the train; retained evidence separately
proves the code reached each phase. The ring retains only the last 128 bytes.

Build from the webflasher root:

```sh
python scripts/case_sbl_reset_early/build.py \
  --case-reference /absolute/path/to/firmware_box.bin \
  --route left --baud 1000000 --output work/reset-early/left-1000000
python scripts/case_sbl_reset_early/run.py inspect-build \
  --build work/reset-early/left-1000000
```

Live `run.py probe` requires the exact case serial, complete stock reference,
compiled SHA confirmation, fresh audit path and
`--execute-stock-reset-early-hello`. The host re-extracts and compares the
native reset trace before USB access, requires inactive OTA/contact presence,
verifies complete case code twice and reads back SRAM before launch. A lost GO
ACK never causes a second launch. Cleanup includes retained-region clearing
and return to stock 1.2.57.

The four route/baud variants each have 31 compiled fault cases. The emulator's
`scripts/probe-usb-reset-early.py` adds 31 timed scenarios with two Renode
exchanges, including fast/late STATUS, unknown/absent reset coupling with local
echo, reset classes that preserve/lose a hypothetical key, window expiry during
the train/setup, and overrun rejection. These are explicit behavioral fixtures;
they do not execute protected retail ROM or establish retail recovery policy.

Current hardware results and unresolved reset/provisioning limits live in
`docs/g2-wired-recovery-goal.md` and its linked goal audit directory.
