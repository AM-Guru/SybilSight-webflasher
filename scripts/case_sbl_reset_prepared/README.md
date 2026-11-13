# Prepared UART reset/HELLO probe

Schema 8 moves all native UART initialization before the same pinned stock PB9
reset train. After release it restores only captured native PB8/PB9 fields,
checks those fields and UART framing/divisor/error configuration, then enables
RX and waits for TEACK/REACK before HELLO. RX remains enabled until cleanup;
no native UART helper or watchdog call occurs between the train and first TX.
Historical schema-3/7 sources and manifests are preserved.

The emitted program still validates every one of the 103 native actions and
62 nominal delay ticks. Native busy delays execute stock code. UART is off
during the train. There is no temple image writer or provisioning operation.

A 24-bit SysTick downcounter starts before the software pin-release writes.
Its end is read after the first HELLO-byte TDR write. The retained result
requires enabled HCLK selection, no wrap, a nonzero interval no greater than
64,000 cycles, and consistent start/end/difference values. At the checked
nominal 64 MHz this is at most 1 ms. A timer fault may stop after the first
fixed HELLO byte (`0x14`); the fault cases check that bounded prefix and cleanup.

This measures a case register-programming interval. It does not measure analog
pogo levels, time to deliver the complete eight-byte HELLO, or an Apollo reset.
The reported microseconds use nominal checked HCLK, not an external frequency
calibration. The emulator counter fixture advances four cycles per VAL read
plus virtual wire time; it is not an instruction-cycle or hardware timing model.
Register definitions follow [ST PM0223, section 4.4](https://www.st.com/resource/en/programming_manual/dm00104451.pdf).

Current builds also sample STM32 GPIOB PB9 immediately after every commanded
PB9 output change in the stock or selected waveform. The retained result
reports whether the output latch matched all commands, whether the digital
input matched all samples, and whether at least one driven-low and driven-high
input sample was observed. This closes the earlier pre/post-only Case sampling
gap. It measures the Case pin while driven; it does not measure voltage at the
glasses pad or establish an Apollo reset. Stuck-high and stuck-low input
fixtures are included in the compiled qualification.

Build from the webflasher root:

```sh
python scripts/case_sbl_reset_prepared/build.py \
  --case-reference /absolute/path/to/firmware_box.bin \
  --route left --baud 1000000 --output work/reset-prepared/left-1000000
python scripts/case_sbl_reset_prepared/run.py inspect-build \
  --build work/reset-prepared/left-1000000
```

Live `probe` requires the exact device/case serial, reference and compiled SHA,
a fresh audit path and `--execute-prepared-reset-hello`. Stock identity, inactive
OTA/contact presence, native-trace re-extraction, two complete code matches and
SRAM readback gate launch. Lost launch ACK never causes another launch. Final
checks cover the native action hash/count/ticks, readiness, early RX, overrun
detection, cycle bound, exact YHM/GPIO/latch restoration, retained clearing and
stock 1.2.57 restoration. The last 128 RX bytes and total RX count are retained.

Current base route/baud builds pass 39 compiled fault cases each. The earlier emulator's
`scripts/probe-usb-reset-prepared.py` added 32 timed scenarios and two Renode
exchanges. The 5-ms native setup fixture that previously missed a 1-ms request
window no longer delays HELLO, while a direct restore fixture over the allowed
counter bound fails. Reset coupling, boot policy and replies remain explicit
fixtures; protected retail ROM is not executed.

Hardware audits, pair-identity limits and the remaining mechanism inventory are
linked from `docs/g2-wired-recovery-goal.md`. A CRC-valid STATUS would still need
recovery-stage, identity, provisioning and image-format review before a writer.
