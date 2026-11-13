# Application-independent G2 SBL discovery

This is the first stage of an experimental USB recovery mechanism. It runs
only in the charging case's SRAM and sends the exact read-only Apollo5 HELLO
request through one temple's pogo UART. It does not require a temple
application reply. It does not implement an Apollo firmware writer.

## What constitutes success

Only a complete 96-byte, type-1, CRC-32-valid Ambiq STATUS frame counts as an
SBL response. Noise, a nonempty capture, echoed HELLO bytes, an application
reply, and the absence of UART errors do not count. Raw bytes are retained
in a 128-byte circular buffer; zero bytes and other values also occurring in
HELLO are never filtered out. The compiled probe stops early on valid STATUS
and the host independently checks it.

The host requires fresh exact case identity and inactive temple OTA,
two consecutive complete live-code matches to the pinned stock case reference, matching source
and payload hashes with passing compiled fault models, exact SRAM readback,
a bounded HELLO-only schedule, a completion marker and retained checksum,
all ten YHM registers restored, cleared results, and normal case 1.2.57 return.

The bridge writes only reviewed YHM routing registers 3–7. It exposes no host
command interpreter or arbitrary forwarding, and contains no image transfer,
flash erase, option-byte modification, recovery, abort, or SBL reset command.
The host's upload helper admits only reserved SRAM code/result regions.
Before printing `ARMED`, the host requires a CRC-checked acknowledgement from
the running Case bridge after its baseline, clock and route checks. The
acknowledgement includes the executed side, baud divisor, profile and schedule.
A GO acknowledgement alone cannot produce the insertion cue. A missing GO
acknowledgement never causes a second launch; retained completion is still
checked after the bounded wait.

## Reset evidence is separate

Case VBUS is charging input. A temple has its own cell, so changing the case's
charging route does not prove an Apollo cold boot. Silence without a measured
reset cannot rule out a short SBL receive window. A silent UART also does not
prove a particular firmware hang or the absence of a watchdog reset.

Earlier case-power experiments must not be described as confirmed cold-boot
tests. A depleted-temple insertion is a candidate experiment; reported battery
depletion remains distinct from an instrument-confirmed reset. Do not defeat
cell protection, short contacts, or force the cell below its normal cutoff.

For a cold-start attempt the probe must be armed before depleted glasses touch
powered contacts. Seating first and launching afterward can miss the entire
bootloader window. `--await-insertion` checks initial absence of the selected
temple. The reviewed baseline gate stays in force: unsupported empty-case
baselines stop the probe. Actual insertion timing still requires qualification.

## Build and validate

Requires Apple clang's ARM target and GNU `arm-none-eabi-ld` and
`arm-none-eabi-objcopy` on PATH:

```sh
python3 -m pip install -r scripts/case_sbl_discovery/requirements.txt
python3 -m unittest discover -s scripts -p 'test_g2_sbl*.py' -v
python3 scripts/case_sbl_discovery/build.py \
  --output work/sbl-right-1m --route right --baud 1000000 \
  --profile observed-33-entry1
python3 scripts/case_sbl_discovery/run.py inspect-build --build work/sbl-right-1m
```

Choose a profile from verified zero-write baseline evidence, using the four
named profiles in `src/lib/yhmProfiles.js`. Never change other baseline bytes
to force a run. Left/right and nominal 115200/1000000 baud use independent
compiled builds. Models exercise echo, bad CRC, late STATUS, wrapped buffers,
unknown baselines and transport/restoration faults. They do not establish
electrical behavior, physical reset or retail provisioning.

## Seated diagnostic

Use the exact case serial, inspected payload digest and official wrapped
`firmware_box.bin` reference:

```sh
python3 scripts/case_sbl_discovery/run.py probe \
  --device /dev/cu.usbserial-XXXX --case-serial CASE_SERIAL \
  --build work/sbl-right-1m \
  --case-reference /path/to/official/firmware_box.bin \
  --confirm-bridge-sha256 SHA256_FROM_INSPECT_BUILD \
  --execute-fixed-hello --output work/sbl-right-live.json
```

The seated build sends at most 20 HELLO frames (160 bytes), with a nominal
8-second receive budget. It does not claim a cold boot. On macOS, 31-byte ROM
reads avoid observed CH340 truncation. The complete case code is checked
before execution. A mismatch prevents any SRAM payload upload.

Exit 0 requires valid STATUS and all cleanup checks. Exit 2 also covers a
completed and restored capture with no STATUS: inspect JSON `outcome` and
`result` to distinguish silence from transport/restoration failure. JSON and
binary evidence includes identifiers; it stays local and is never uploaded.

For armed insertion, build with `--attempts 4000` and add `--await-insertion`
to `probe`. Keep glasses outside the contacts until `ARMED` is printed. Do
not use another USB client at the same time. This is an experimental capture
window with 20-ms receive intervals over a nominal 80 seconds, not proof that
any particular SBL receive deadline was met. Between attempts the case UART
changes direction and the watchdog is serviced at bounded intervals; those
gaps remain part of the unqualified physical capture timing.
The host additionally waits for estimated transmit/direction-change overhead
before reading the completion proof. The actual timing is not calibrated.

To qualify the Case alone while the glasses remain outside, use
`--empty-case-check` instead of `--await-insertion`. Both contacts must be
absent. This exercises readiness and cleanup without printing an insertion
cue or claiming any result about temple recovery. Either compiled schedule
can be checked this way.

## Experimental GPIO entry bias

`--entry-bias pb9-low` adds a bounded candidate boot-strap experiment. Other
fixed choices are `pb9-high`, `pb8-low`, `pb8-high`, and `none` (the default).
Case PB9 is a candidate route to Apollo GPIO42; PB8 is a candidate route to
GPIO44. Neither retail boot-override provisioning nor the electrical transfer
of a case pull through the contact router has been measured.

The bias stage disables USART3 and sets **both case pins to input**. It selects
only an internal pull-up or pull-down on the chosen pin; it never enables a
push-pull or open-drain output. After a one-ms settling interval, the case pad
must read the requested level before a 32-byte CRC-checked READY frame is
emitted. READY binds the side, baud, router profile, schedule, pin, polarity,
and fixed five-second hold. The level is checked once per nominal millisecond
during the hold. A mismatch or timer failure releases the bias and skips HELLO.

At five seconds the bridge removes both pulls, verifies both pins are inputs
with no pulls, then starts HELLO capture. It restores and checks the original
PB8/PB9 mode, pull, speed, output-type and alternate-function fields on every
cleanup path, as well as all ten YHM registers. Retained results include phase
flags, hold ticks, and the packed before/after GPIO fields. A failed release
prevents any HELLO transmission. The hold and release run on the case and need
no subsequent command from the host.

This is a **weak-bias prototype**, not a proven way to force boot recovery.
A live output or router buffer may defeat the pull. A matching case-pad level
does not prove the Apollo-pad level. It does not emit the stock PB9 reset train,
toggle a proven reset pin, or write BOOT_OVERRIDE, INFO0, OTP or MRAM. Its trigger
context is insertion of genuinely depleted glasses. Previously depleted glasses
that have since charged do not establish this context.

Build one configuration for a trial:

```sh
python3 scripts/case_sbl_discovery/build.py \
  --output work/gpio-entry-right-pb9-low \
  --route right --baud 1000000 --profile observed-33-entry1 \
  --attempts 4000 --entry-bias pb9-low
python3 scripts/case_sbl_discovery/run.py inspect-build \
  --build work/gpio-entry-right-pb9-low
```

First qualify with the glasses outside using `probe --empty-case-check` and
the same device/identity/reference/digest arguments shown above. No insertion
cue is printed. A real trial instead uses `--await-insertion` together with
`--reset-evidence operator-reported-depleted-insertion`. That option records an
operator report, never an instrument-confirmed reset. A seated bias run is
rejected. For example, after replacing all placeholders:

```sh
python3 scripts/case_sbl_discovery/run.py probe \
  --device /dev/cu.usbserial-XXXX --case-serial CASE_SERIAL \
  --build work/gpio-entry-right-pb9-low \
  --case-reference /path/to/official/firmware_box.bin \
  --confirm-bridge-sha256 SHA256_FROM_INSPECT_BUILD \
  --execute-fixed-hello --await-insertion \
  --reset-evidence operator-reported-depleted-insertion \
  --output work/gpio-entry-right-live.json
```

Keep the glasses outside during code verification. Have them ready near the
contacts, then insert immediately when the terminal prints `ARMED`. The host
suppresses the cue if READY arrives two or more seconds after launch, leaving
at least approximately three seconds in the nominal hold when it does print.
This timing is not electrically calibrated. Insertion close to the deadline,
slow temple power-up, or an SBL UART timeout before release can all miss the
window. A negative trial cannot distinguish these from absent provisioning.
Each pin/polarity experiment needs a fresh suitable reset; changing builds does
not reset a battery-powered temple. No firmware writer follows automatically
from a positive response.

Compiled validation adds five GPIO-specific faults: initial and mid-hold level
mismatch, bias timer timeout, failed GPIO restoration, and failed bias release.
The models require input mode during the hold, exact configured pulls, pad
readback before READY, no HELLO before release, unchanged unrelated GPIO fields,
and bounded completion. They do not model the router electronics or Apollo ROM.

GPIO-specific retained status values are `11` (pad level mismatch), `12`
(hold timer failure), `13` (GPIO restoration failure), and `14` (release
readback failure). Status `15` stops on an unexpected native watchdog GPIO
descriptor. The bridge initializes that descriptor to PB2 explicitly because
an SRAM launch skips the stock C runtime's initialized-data copy; it checks
the descriptor before every native watchdog call, including the completion
tail. Pad/descriptor failures retain GPIO MODE/PULL/INPUT and descriptor mask
and mode as diagnostics, separate from the UART capture.

An empty-case `outcome: no-valid-sbl-status-captured` with
status zero is a completed qualification, not an expected SBL response. A
pad mismatch instead has `outcome: failed-closed`, with no insertion cue and
no temple UART traffic. Both outcomes still require verified cleanup.

## What follows STATUS

Bind its chip identity and physical side, inspect the SBL version (including
the INFO0/INFO1 erratum), and establish the retail provisioning and accepted
image format. A normal EVENOTA package is not automatically an Ambiq wired
or MRAM-recovery image. Do not feed it to the vendor uploader or substitute
SDK sample recovery binaries. No image-write command is implemented here.

The framing layout was checked against local AmbiqSuite 5.2.0
`tools/apollo510_scripts/uart_wired_update.py` (`connect_device`), SHA-256
`47ef653b84b57377243b7c0c88486120f76450c9cc6cfaea7749fa9554ff735c`.
Primary references:

- [Nordic nPM1300 overview](https://docs.nordicsemi.com/r/bundle/ps_npm1300/page/product_overview.html)
- [Nordic ship/hibernate behavior](https://docs.nordicsemi.com/r/bundle/ps_npm1300/page/chapters/core_components/ship/doc/ship-mode.html)
- [Ambiq Apollo510 errata](https://contentportal.ambiq.com/documents/20123/4133620/Apollo510-Errata-List_v2p0.pdf)

## Earlier HELLO-only qualification recorded on 2026-11-04

The implementation passed 26 new Python tests and the 37 existing Python
flasher regression tests. Eight current payload builds (two routes, two baud
rates, two schedules) each passed 19 compiled Cortex-M0+ fault-model cases.

Earlier discovery builds completed seated probes on both sides at both baud
rates: 20 HELLOs per capture, zero received bytes, exact ten-register
restoration and normal case return. This was not a timed cold-start test.

That readiness-enabled right/1-Mbaud build was then exercised with
both temples outside the case, first with 20 and then with 4,000 attempts.
Both returned a valid post-routing readiness acknowledgement. The long run
completed all 4,000 HELLOs (32,000 UART bytes), serviced the external watchdog
25 times, recorded zero UART errors, restored all ten registers byte for byte,
cleared the retained result, and returned to case 1.2.57. These checks establish
Case-side execution and cleanup for that configuration. Receive timing during
insertion, a live retail SBL response, and an accepted recovery image remain
unproven. No persistent firmware writes were performed.

## GPIO prototype qualification recorded on 2026-11-04

The current revision passed 32 Python protocol/host tests plus the 37 existing
flasher regression tests. Twenty-one current builds passed 520 compiled model
cases in total, with source/payload provenance rechecked afterward. The matrix
covers both routes, both baud rates and all four bias choices at 4,000 attempts,
all four right/1-Mbaud choices at 20 attempts, and a no-bias control. GPIO builds
have 25 fault-model cases; the no-bias control has 20.

Four right/1-Mbaud, 20-attempt configurations were exercised on the empty case:

| Bias | Case-side result | HELLO bytes | Cleanup |
| --- | --- | ---: | --- |
| PB9 high | READY, 5,000 hold ticks, verified release | 160 | exact |
| PB8 high | READY, 5,000 hold ticks, verified release | 160 | exact |
| PB9 low | initial pad mismatch; no READY | 0 | exact |
| PB8 low | initial pad mismatch; no READY | 0 | exact |

For each low-bias stop, the retained GPIO registers show input mode and the
requested pull-down, while INPUT reads both pogo case pins high. A weak pull
therefore did not establish low on this setup. These results do not qualify
an active-low recovery override. A matching high readback also does not prove
the pull changed the level or reached the Apollo pin.

Each of these four runs restored all ten router registers and the original PB8/PB9 fields,
cleared its retained result and returned to stock case 1.2.57. No image bytes,
flash erase, case-flash writes or provisioning changes were performed. A live
retail SBL reply and physical Apollo reset remain unverified.

The first revision's high-bias test stopped at the first native watchdog call.
The current revision explicitly initializes and guards the shared PB2 GPIO
descriptor; its subsequent high-bias runs completed the full short schedule.
Earlier build manifests are intentionally rejected by current source-hash
checks. Current receipts and builds use the `gpio-bias-r2-` prefix under
`work/usb-stock-recovery-20261104/`.

The current right/PB9-high/1-Mbaud 4,000-attempt payload also completed an
empty-case qualification: valid READY, 5,000 hold ticks, verified release,
4,000 HELLOs (32,000 UART bytes), 30 native watchdog-helper services, zero UART
errors, exact GPIO/router restoration, cleared result and case 1.2.57 return.
No receive data was expected or observed with the glasses outside. An initial
attempt stopped during a ROM code-read timeout before upload; the subsequent
fresh loader session passed both full code checks and completed the probe.
The failed attempt and successful retry have separate receipts.

The local summary is
`work/usb-stock-recovery-20261104/gpio-entry-prototype-validation.json`.

## G2 emulator integration

The sibling `g2-firmware-emulator` repository now provides
`scripts/probe-usb-recovery.py` and `docs/usb-recovery-entry.md`. It can compile
fresh builds, run their actual Cortex-M0+ instructions against 44 explicit
entry/transport scenarios, and exchange selected synthetic HELLO/STATUS traffic
through Renode's existing Apollo GPIO/UART2 models. The shared artifact checks
and retained-result decoder are in `artifacts.py`, which imports no physical
device transport or pyserial. The physical `run.py` imports those same checks.

The emulator adapter adds nominal wire time and reset events to the simpler
fault fixture, discarding reply bytes sent before case RX is enabled. It also
models the initial pad-level refusal and reports hypothetical insertion timing.
Its SBL policy/response is explicitly synthetic: no Apollo ROM image, retail
provisioning or physical reset is supplied. Source changes require fresh build
manifests even though the case C payload itself is unchanged.

In particular, five seconds of held bias can miss a short SBL receive window
if reset occurs early, and a fast reply can lose its header during the native
UART direction change. These are conditional emulator results, not measured
properties of these glasses. No hardware drive strength, pin mapping, temple
command allowlist or image-write capability was expanded.
