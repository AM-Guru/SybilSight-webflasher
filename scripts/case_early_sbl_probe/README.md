# Early-armed SBL HELLO probe

This case SRAM payload checks for an already listening wired bootloader. It
sends only the fixed eight-byte Ambiq HELLO (`14559de900000800`), at most 20
times, with a nominal 400 ms receive interval per request. It does not reset a
temple, upload a firmware image, modify case flash, or infer recovery entry.

RX is acknowledged before the first transmitted byte, remains enabled while
sending and between requests, and is never reinitialized or flushed after the
first HELLO. Overrun reporting is enabled and checked. Native external-watchdog
service between attempts 8 and 16 creates CPU polling gaps; an overrun in a gap
fails the test. Local transmit reflection is retained and never treated as a
bootloader reply. Only a complete 96-byte type-1 STATUS with correct CRC32
qualifies; even that would need device/stage/identity review before a writer.

Build one fixed route and baud from the webflasher root:

```sh
python scripts/case_early_sbl_probe/build.py --route left --baud 1000000 \
  --output work/early-sbl/left-1000000
python scripts/case_early_sbl_probe/run.py inspect-build \
  --build work/early-sbl/left-1000000
```

The four emitted route/baud variants passed 28 compiled fault cases each.
`g2-firmware-emulator/scripts/probe-early-sbl.py` adds 14 timed scenarios,
including two Renode exchanges. Its listeners, timing and boot policy are
explicit synthetic fixtures; protected retail ROM is not executed. Local echo
is modeled separately from the existence or baud of a temple endpoint.

A live `run.py probe` requires exact device/case serial, official case reference,
compiled SHA confirmation, fresh audit output and `--execute-fixed-hello`.
Preflight checks stock 1.2.57, inactive OTA and selected-side contact presence.
Two complete case-code readbacks and SRAM readback precede execution. Retained
schema 6 binds readiness, route, baud, schedule, UART errors and exact YHM/GPIO
restoration. The host clears/verifies retained SRAM and restores stock operation
on completion. Losing launch acknowledgement never causes a second launch.

Hardware outcomes and their physical limits are recorded in
`docs/g2-wired-recovery-goal.md` and the goal audit directory. Case execution or
self-echo does not establish that the temple is powered, reset or listening.
