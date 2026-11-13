# Stock reset followed by SBL capture

This experimental probe executes in **case SRAM**, selects one temple, emits
the stock case's PB9 reset sequence, releases the output, and sends only the
eight-byte SBL HELLO. It accepts a response only after the full 96-byte STATUS
frame and its CRC are valid. It does not upload a temple image, erase memory,
change INFO/OTP, or implement an SBL firmware writer. The reset waveform is an
active electrical stimulus; this is not a read-only diagnostic.

## What the code analysis establishes

The reviewed B200 1.2.57 case image contains the reset routine at `0x0800B678`.
The no-reply reset caller configures PB9 as a push-pull output using the
descriptor at `0x0800D36C`. Its left/right prepare routines (`0x0800BE90` and
`0x0800BEDE`) select the same YHM route used by the UART probe:
`5=03, 6=C1, selected 3/4=A6`, delay 30 ticks, then `7=03/05`.
OpenCFW's readable reconstructions are in
`g2/src/case/startup/application_policy_{reset_pulse,no_reply_reset,ota_side_prepare}_candidate.c`.

`trace.py` executes the **actual pinned stock binary** under Unicorn and
extracts its 103 GPIO/delay actions. The build generates a fixed table from
that trace and checks the stock PB9 descriptor. The payload uses the original
busy-loop function at `0x0800A7A2`. It replaces RTOS delays with bounded,
nominal 1 ms SysTick waits because no case RTOS is running in this SRAM probe.
There are 62 nominal delay ticks plus 130,100 busy-loop iterations. Software
dispatch and audit bookkeeping add uncalibrated overhead. This is action-order
reproduction, **not a physically measured or cycle-identical waveform**.

PB9 is also used by the case's receive path. RX is unavailable during the
train. The first HELLO follows release without the old five-second bias hold
or an intervening watchdog service. Native UART TX/RX helpers still introduce
unmeasured setup and turnaround gaps. There is no claim of continuous RX,
including during later HELLO transmissions or direction changes.

## What remains unknown

The stock train's presence does not establish an Apollo reset or SBL entry.
The glasses' circuit/PMIC interpretation and resulting reset class remain
unknown. A cold reset cannot be assumed to preserve a previously armed
OTAPOINTER key. Application-initiated recovery also requires compatible
silicon/policy and a key installed by code that actually executed; this probe
cannot retroactively install that hook in a non-booting application.
OpenCFW's `g2/src/apollo-main/system/self-recovery/self_recovery.c` explicitly
identifies its arming hook as custom code, not stock firmware. Its presence in
the checkout does not establish that it is installed or armed on either pair.

The separate Even bootloader path checks the OTA flag at `0x007FE000` against
`0x55555555` (`g2/src/apollo-bootloader/manager-task/manager_task.c`) and uses the
staged file `ota/s200_firmware_ota.bin`. Those traced paths do not establish a
bootloader UART image receiver. They must not be confused with Apollo SBL's
separate wired-recovery entry mechanism.

The retail boot override, enabled wired interface, pin mapping, baud, recovery
timeout, SBL version and image authentication policy remain unverified.
[Ambiq ERR034](https://contentportal.ambiq.com/documents/20123/4133620/Apollo510-Errata-List_v2p0.pdf)
also documents that older SBL versions use INFO1 rather than INFO0 for
application/GPIO recovery, with the fix at SBL 1.16. That prevents treating a
candidate INFO0 UART configuration as sufficient evidence for retail recovery.
An emulator STATUS response is always marked synthetic and never proves any
of these retail settings.

## Build and offline validation

From the webflasher root, using an environment with Unicorn and pyserial:

```sh
python scripts/case_sbl_reset_capture/build.py \
  --case-reference /path/to/official/firmware_box.bin \
  --output work/reset-builds/right-1000000 --route right --baud 1000000
python scripts/case_sbl_reset_capture/run.py inspect-build \
  --build work/reset-builds/right-1000000
```

Build left/right at both supported bauds. The case reference is the wrapped
case image: only this case image has its 32-byte wrapper removed. No temple
bootloader blob is consumed. The build rejects any other complete case code.
Each build executes 25 compiled fault cases: baseline and clock rejection,
UART echo/CRC/ring handling, bounded timer/TX failures, reset timer/release
failures, and exact YHM/GPIO restoration, including output latches.

The emulator runner is `g2-firmware-emulator/scripts/probe-usb-reset-recovery.py`:

```sh
.venv/bin/python scripts/probe-usb-reset-recovery.py \
  --webflasher-root /path/to/SybilSight-webflasher \
  --builds /path/to/reset-builds --output generated/recovery-reset/new-run --renode
```

Its 25 scenarios vary reset coupling, pre-armed key preservation, cold-reset
key loss, GPIO override, unknown/disabled/mismatched wired provisioning,
short windows and UART setup/turnaround latency. Two positive scenarios can
exchange HELLO and synthetic STATUS through the G2 Renode UART peripheral.
The compiled case payload executes under Unicorn; protected Apollo SBL ROM
does not execute. The assumed busy-loop cost defaults to six cycles per
iteration and is explicitly uncalibrated.

## Bounded hardware test

The 2026-11-04 local hardware run tested the original failed-update pair seated
directly in the case: both sides at both bauds. All four retained results
verified the 103 actions, 20 HELLO requests per variant, exact YHM/GPIO cleanup,
and return to stock case 1.2.57. Total: 80 HELLO requests, 640 UART bytes sent,
zero UART bytes received. Normal version requests were unanswered before and
after. No firmware image was written. Physical Apollo reset and SBL entry
remain unverified. This run proceeded with the original pair as seated by the
operator; the planned empty-case/secondary controls were not performed.
See the local [hardware result](../../work/usb-stock-recovery-20261104/reset-hardware-original/HARDWARE-RESULT.md)
and its adjacent `hardware-summary.json` for the audit paths and retained-result
digests. The offline build manifests retain `hardwareValidated: false`; actual
execution evidence is recorded separately in those hardware audits.

First disconnect external pogo/Dupont leads and leave the USB-powered case
empty. Do not use unresolved Jumperless contact readings as a continuity or
polarity qualification. This version is intended to test the normal seated
case contacts without a breadboard extension.

The host verifies the exact case serial, stock version, inactive OTA state,
and contact presence. It requires **two consecutive full live case-code
matches** before uploading the payload to reserved SRAM, then reads back each
SRAM write. It launches once, checks a CRC-bound READY frame, waits for bounded
completion, reads and validates the retained audit, clears it, and restores
the stock case application. It exposes no flash-write operation.

```sh
python scripts/case_sbl_reset_capture/run.py probe \
  --device /dev/cu.usbserial-210 \
  --case-serial 002300405845501620373941 \
  --case-reference /path/to/official/firmware_box.bin \
  --build work/reset-builds/left-1000000 \
  --confirm-bridge-sha256 EXACT_DIGEST_FROM_MANIFEST \
  --output work/reset-empty-left.json \
  --execute-stock-reset-hello --empty-case-check
```

After empty-case execution and cleanup are verified, seat the secondary pair
directly and recheck its normal firmware-version response as a control. A
seated probe omits `--empty-case-check`; both contacts must be detected.
Exercise one side/baud per fresh audit. Establish scope/cleanup on the
secondary pair before repeating on the original pair. No next-stage image
write follows from silence. A valid hardware SBL STATUS would justify a
separate investigation of authenticated stock-image transfer.

Empty-case qualification proves only case execution and restoration. A seated
negative probe means no valid response was captured under this stimulus; it
does not determine whether the Apollo reset, entered SBL, used another UART,
or had a shorter response window. Any physical timing claim still requires a
properly connected logic analyzer or oscilloscope capture.
