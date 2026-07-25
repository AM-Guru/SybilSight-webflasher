# Even Realities G2 Webflasher

A browser-based analyzer, combined Case + Smart Glasses recovery-backup
utility, guarded charging-case recovery console, and application-alive CFW
reinstall tool for the Even Realities G2.

The webflasher communicates directly with the case through Web Serial. All
device communication and firmware validation happen locally in the browser;
case data and uploaded firmware files are not sent to a server.

Production deployment:
[webflasher.sybilsight.com](https://webflasher.sybilsight.com/)

## What it supports

- Connects to the retail case's WCH CH340/CH341 USB Serial interface
  (`1A86:7523`).
- Reports case firmware, exposed identifiers, battery and charging telemetry,
  lid state, USB state, glasses presence, temperature, and scalar case state.
- Separates Analyze into Charging Case, Smart Glasses, and Shell & Evidence
  views. The glasses pass captures version, hardware revision, battery,
  voltage, checksum-valid raw frames, and per-route transport/restoration
  proof for both temples.
- Downloads a structured local analytics report containing the case factory
  shell transcript, allowlisted `DEA0`/`DEA2`/`DEA3`/`DEA4` query meanings,
  left/right temple frames, recovery eligibility, and the hardware-validated
  transfer record.
- Identifies the STM32 ROM bootloader, option-byte configuration, active
  physical bank, fallback physical bank, and the firmware visible in each bank.
- Downloads one combined recovery set containing a complete 512 KiB case
  flash backup, the 128-byte case option block, checksum-validated identity
  snapshots from both seated temples, and the matching digest-pinned official
  Smart Glasses firmware bundle.
- Accepts official five- or six-component `EVENOTA` bundles, wrapped
  `firmware_box.bin` components, and validated raw case images.
- Recognizes all 12 archived official G2 SHA-256 values and the exact reviewed
  SybilSight 2.2.6.10 CFW SHA-256.
- Validates the Apollo main application's independent preamble, CRC-32, target
  region, installed-image boundary, and vector.
- Stages case firmware in the inactive bank and verifies a byte-for-byte
  readback before activation is available.
- Uses the traced stock `B0` command to reset both seated temples, then waits
  for their case links and presence telemetry to return.
- Runs the exact reviewed, read-only USB-to-pogo SRAM bridge for left/right
  temple status or firmware/hardware version, with retained transport and
  YHM-restoration proof.
- Computes the recovered `0x52...0x55` pogo OTA record plan for every
  component in a selected official or reviewed-CFW bundle without emitting
  any OTA command, and explicitly marks the Apollo bootloader as omitted.
- Transfers only the exact reviewed CFW Apollo-main payload for installation
  on either or both running temples through the hardware-validated volatile
  case-USB bridge.
  The browser requires fresh presence telemetry, independent bundle/main/
  bridge trust pins, explicit risk confirmations, exact per-record replies,
  postflight liveness, retained route-restoration proof, volatile-data
  cleanup, and normal case 1.2.57 return.
- Presents both recovery targets under Recover: three-step inactive-bank
  staging/activation for the charging case and a separately gated left,
  right, or both-temple reinstall for responsive Smart Glasses.
- Decodes read-only Apollo510 INFOC and active INFO0 debugger dumps locally,
  then fails closed unless every known SBL UART field matches the pogo route.
- Provides a session console with downloadable logs.

## Important limitation

This is a **charging-case recovery and running-temple reinstall tool**. It is
not a dead-temple recovery tool.

The stock G2 case firmware does not expose a USB command that writes Apollo
firmware to an unresponsive glasses temple. The case can power, reset, and
check the glasses, but this tool cannot reflash a dead left or right temple
through the stock case.

SybilSight has physically verified that a reviewed, volatile SRAM payload can
use the case's existing USART3/YHM2510 front end to exchange fixed status and
version requests with either **running** temple. That is not a stock
USB-to-pogo command, a generic byte bridge, or a dead-application recovery
mechanism. After explicit seated-glasses confirmation, the webflasher can
load that exact digest-pinned bridge into high case SRAM. The payload contains
only embedded status/version requests and cannot accept arbitrary temple
bytes or firmware-transfer commands.

That boundary also applies to the reviewed CFW. Its case component is
byte-identical to stock case 1.2.57, so the webflasher never presents case-bank
staging as a way to install CFW. Instead, the guarded running-temple control
loads a volatile, hash-gated case bridge and sends only the pinned CFW Apollo
main. The stock case application itself still has no such forwarding command.
This path cannot run if the temple application or its UART task is dead.

The case write and bank-activation path is research-derived and experimental.
It has not been physically validated by this repository on sacrificial
hardware. Read the safety section before using any write operation.

## Current firmware model

Official G2 2.2.6.10 is a six-component bundle for the codec, BLE
coprocessor, touch controller, charging case, Apollo bootloader, and Apollo
main application. The Apollo510B side uses a single in-place application, not
an A/B rollback:

- Even bootloader base: `0x00410000`
- main application base: `0x00438000`
- staged-install flag boundary: `0x007FE000`

The bootloader can replay a complete staged main image after some interrupted
installs, but no last-known-good application slot or boot-attempt rollback has
been found. It also does not initialize the application's UART2 case link, so
a transparent case bridge would not itself create a dead-temple recovery
route.

In every mirrored G2 main release from 2.0.1.14 through 2.2.6.10, the running
Apollo application configures UART2 at 1,000,000 baud, 8N1, without flow
control:

- Apollo GPIO42/TX reaches case PB9/USART3_RX.
- Apollo GPIO44/RX is driven by case PB8/USART3_TX.
- The case selects the left or right path through its YHM2510 front end and
  time-separates TX-only and RX-only operation.

The reviewed CFW is an exact, machine-described transformation of official
2.2.6.10:

- stock SHA-256:
  `f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa`
- CFW SHA-256:
  `5c1539fd39c599e6035f6a8ec0779ba687c250d342a24c21a39952fed6c56aa0`
- patch-manifest SHA-256:
  `44f3a863dc2e7043cb65bcecd42ea9798c70752309ce21c56bdac5a29c1c476c`
- 16 expected-byte-gated operations, including one appended code blob and
  the required inner/outer size and checksum updates

It adds 576×288 image containers, RLE and LZ4 payloads, 8bpp XOR-delta
updates, per-lens stereo image pairs, a settings capability advertisement,
and ring long-press/release events. These features remain capability-gated;
structure alone is not proof that a file is the reviewed CFW.

### Application-alive pogo OTA

The current G2 main application contains a product-test dispatcher on its
1-Mbaud case/pogo UART. Commands `0x52...0x55` wrap the same normal component
OTA service used by the BLE `0xC0/0xC1` path:

| Command | What status zero proves | What it does not prove |
| --- | --- | --- |
| `0x52` | Product-OTA state initialized and normal OTA start dispatched | Any file or MRAM write |
| `0x53` | The exact 128-byte component header was accepted and forwarded | Payload storage |
| `0x54` | Sequence, length, and CRC checks passed; at 6,000-byte/final boundaries work is queued to the normal parser after the reply | Durable filesystem or MRAM commit |
| `0x55` | The normal OTA parser ran and returned its shared component-result byte | Reboot, installation, or the final bootloader MRAM copy |

This is a credible reinstall route only while a temple's main application and
UART task are alive. It is not a bootloader protocol, installed-MRAM backup,
or dead-temple recovery path.

The later commit boundary is component-specific. Apollo main firmware is fully
staged as `ota/s200_firmware_ota.bin`; only after its complete staged-file CRC
passes does the application write update flag `0x55555555` and reset so the
intact Even bootloader can install it. The Apollo bootloader is staged as
`ota/s200_bootloader.bin` and then copied directly into MRAM at `0x00410000`.
Its shared `0x55` result can report success before that later copy occurs.
Power loss or copy failure can therefore destroy the only Even bootloader
despite a successful-looking reply.

The stock case USB factory dispatcher does not originate or forward these
commands. SybilSight first verified the reconstructed path with fixed
`yhm-immediate-rx` probes, then physically validated a host-commanded,
one-request USB bridge. The working sequence selects one YHM2510 route,
transmits an internally embedded unframed request, switches USART3 from
TX-only to RX-only, and begins capture immediately—before any YHM/PMIC
diagnostic adds enough delay to miss the short reply.

Both left and right routes returned checksum-valid `5A A5 FF` application
frames with zero USART errors:

| Query | Physically observed result |
| --- | --- |
| Status `0x13` through the host bridge | Left 4,497 mV / 99%; right 4,487 mV / 99% |
| Version `0x24` | Both temples report firmware 2.2.6.10 and hardware revision 5 |

The reviewed bridge is exactly 1,712 bytes with SHA-256
`742f4652f2ce7a46fd6d0e7ab9500906ff2402198b74790fddf44ebf80006c12`.
It accepts only status, version, or a no-contact exit self-test. All successful
route reads/writes and transmit counts matched, the starting YHM image was
restored byte-for-byte, the retained proof/result regions were cleared, and
stock case firmware 1.2.57 resumed normally. A non-idle charging-route image
was also physically observed to fail closed before transmission.

The webflasher keeps this fixed read bridge for diagnostics and separately
embeds the exact reviewed 2,872-byte write bridge. Neither path is an
arbitrary USB-to-pogo sender. The writer's SRAM code permits only the version
query and Apollo-main `0x52...0x55` state machine, while the browser
independently permits only the complete reviewed CFW and its pinned main
payload.

The shared fail-closed host validates the complete bundle, permits only the
Apollo main component, never blindly replays `0x52` start or `0x53` header,
and retries only the exact current `0x54` record. That retry is safe both when
an accepted record's reply was lost—the previous sequence is idempotent—and
when an explicit rejection left the expected sequence unchanged. The host
waits 100 ms at each 6-KiB handoff and requires both the checksum-valid
zero-status `0x55` reply and postflight liveness. The stock case console
cannot do this without the temporary SRAM bridge.

Nine experimental case-USB runs were attempted with the reviewed CFW.
Attempts 1 through 5 ended `failed_or_uncertain`. Attempt 3 used bridge
SHA-256
`9945e4cd3b2ba1edb2328b5ddf6d3580443d566d333aef8e4d061f2981febecd`
but received no case-bridge response header. Attempt 4 used diagnostic bridge
SHA-256
`8370f0a7600a986b1b0e95b8e4798a32b03060b9e0e462bb6e4931bae2ea6833`.
It confirmed the right temple was running 2.2.6.10/hardware 5 and its retained
diagnostics showed 97,000 of 3,539,474 main-image bytes accepted, expected
sequence 97, 100 temple transmits, 10 temple responses, and zero reported
temple-UART errors. It then stopped returning host responses. The retained
result had a zero restored-register mask and no cleanup proof, so the log does
not establish a complete transfer, restored case routing, or a known final
temple state.

Attempt 5 used bridge SHA-256
`9138198c7d031f9a98a5d20c0df55293fdd3b37489c7fddeb4d94c7eed07018f`.
It timed out after receiving only five bytes of the host transaction header,
accepted no firmware payload, and never contacted the temple application
beyond one transmit attempt. Its retained record nevertheless contained the
expected proof, matching baseline and restored YHM bytes
`810004aeae03812022ff`, and baseline/selected/restored masks of `0x3ff`.
Stock case firmware 1.2.57 resumed. This is useful fail-closed restoration
evidence, but the runner correctly did not mark cleanup verified because the
retained terminal status was `16` (host request timeout).

The reviewed case-write bridge source now lives alongside the SybilSight host
and assembles to the declared 2,872 bytes with SHA-256
`08a08f45ac125a1dba6469234e56cacd32147d9e79203327987276d2fb182b02`.
Attempt 6 used those exact bytes and completed the right-temple transfer:

- the reviewed CFW bundle SHA-256 and main-payload SHA-256 were pinned;
- preflight reported firmware 2.2.6.10 and hardware 5;
- all 3,539,474 bytes were accepted in 3,540 records with zero retries;
- the `0x55` finish acknowledgement was received;
- postflight again reported firmware 2.2.6.10 and hardware 5;
- all ten YHM registers were restored byte-for-byte;
- retained status was zero and case firmware 1.2.57 resumed normally.

The postflight version cannot distinguish stock from this CFW because both
report 2.2.6.10, so the input bundle and main-payload hashes remain essential
provenance. Attempt 7 used the same bridge on the left route and failed closed
at setup status 3 because the observed YHM baseline was not an allowlisted
seated-idle state; it transmitted no firmware bytes.

Attempt 8 reached the left temple with the same bridge and reviewed CFW.
Preflight again reported firmware 2.2.6.10/hardware 5. The temple accepted
2,733,000 of 3,539,474 Apollo-main bytes before returning explicit status 1
for a `0x54` data record. The audit retained 2,733 as the expected next
sequence count, zero temple-UART errors, complete baseline/selected/restored
masks, byte-for-byte YHM restoration, and normal case firmware 1.2.57 return.
The run remains `failed_or_uncertain` because there was no finish
acknowledgement or postflight version.

That explicit rejection exposed a safe retry case missing from the original
host policy: a rejected record does not advance the temple's expected
sequence, so the exact CRC-protected record can be retried. SybilSight now
tests and permits that data-only retry alongside the existing lost-reply
retry; start and component-header transactions remain non-replayable.

Attempt 9 then completed the left-temple transfer using the same pinned bridge
and reviewed CFW. All 3,539,474 bytes were accepted in 3,540 records with zero
retries, the `0x55` finish acknowledgement arrived, and postflight reported
firmware 2.2.6.10/hardware 5. The retained result recorded status zero,
complete baseline/selected/restored masks, byte-for-byte YHM restoration, and
normal case firmware 1.2.57 return.

A later failed-OTA recovery added one more hardware result. The right display
worked, but the Case initially reported `GLS_L=0, GLS_R=1` and the left
application did not answer. The fixed reset probe reproduced the stock
dual-route reset waveform, restored its captured YHM image byte-for-byte, and
returned Case 1.2.57. Fresh telemetry then reported both contacts; a
checksum-valid left version reply decoded as 2.2.6.10/hardware 5, and the user
confirmed both displays working. That recovery sent no firmware bytes, so it
validates reset-and-liveness recovery—not an official-image transfer.

Accordingly, the validated write scope is the reviewed Apollo main image on a
running left or right temple. Stock images remain hash-pinned but do not yet
have completed case-USB transfer evidence. The guarded browser and Python
implementations expose that boundary and now require the validated final
dual-reset/contact/version phase. Application-dead recovery remains unproven.
Both continue to mark the Apollo bootloader component **OMIT FROM POGO** until
an independent SBL, MRAM-recovery, or SWD route is proven.

For offline analysis, selected `EVENOTA` bundles show the exact number of
1,000-byte `0x54` records and final sequence value for each component. The
recovered writer grammar uses an exact 128-byte component header for `0x53`,
CRC-16/CCITT-FALSE over each `0x54` data payload, a modulo-256 sequence, and
6,000-byte deferred batches. The expected sequence starts at zero and accepts
the immediately previous value as an idempotent `0x54` retry; an explicitly
rejected current record can also be retried because the sequence did not
advance. Start and header are not treated as replay-safe. Offline calculation
never contacts a temple. During a real transfer, each acknowledgement is
parser acceptance rather than independent proof of a durable write. The final
acknowledgement, post-reset version, route restore, retained-proof cleanup, and
case-application return are all mandatory for a successful audit.

### Temple backup boundary

The current Apollo application routes BLE OTA lanes `0xC2/0xC3` to a
running-application LittleFS export service. Static analysis indicates that an
authenticated BLE client could potentially retrieve
`ota/s200_firmware_ota.bin` if the staged file remains after the last update.
That would recover the received main-application OTA artifact, not a snapshot
of installed MRAM.

The export does not include the separately installed Even bootloader,
pairing/calibration/key material, INFO0/INFOC, or current internal-memory
state. Present file availability and the full authenticated request sequence
have not been physically validated. The stock case and this USB webflasher
cannot reach `0xC2/0xC3`, so the combined backup does not claim an
installed-memory dump. Instead, it records checksum-validated version and
hardware snapshots from both running temples and embeds the matching official,
digest-pinned `EVENOTA` recovery bundle. This preserves a complete glasses
recovery image for the reported release while keeping the installed-MRAM
boundary explicit in the artifact.

### Dead-application recovery candidates

Ambiq's protected SBL can support a wired UART update after an invalid OEM
image or a provisioned GPIO override, but retail G2 enablement has not been
established. The normal application's proven GPIO42/GPIO44 pogo route is only
a candidate: SBL UART enablement, module, pins, baud rate, override pin,
receive window, lifecycle policy, and image authorization come from
per-device INFOC/INFO0 provisioning.

The stock case has no SBL `HELLO` implementation. A dead-temple claim therefore
requires a read-only INFOC/INFO0 dump and the full, unmasked
`RSTGEN->STAT` value, followed only if provisioning matches by a passive SBL
window capture. Until then there is no proven retail pogo, BLE, or stock-case
path for reflashing an application-dead temple.

The offline decoder in the webflasher checks the recovered provisioning words
without transmitting to hardware:

- INFOC `BOOT_OVERRIDE` at `0x400C2250`
- INFOC `WIRED_CONFIG` at `0x400C2254`
- INFOC active-INFO0 selector at `0x400C23FC`
- active INFO0 UART words at offsets `0x28...0x3C`
- active INFO0 receive timeout at `0x54`
- active INFO0 MRAM-recovery control at `0x68`

An exact match to the known application contacts requires UART2 enabled,
configuration word `0x0F4240C0` (1,000,000 baud, 8N1),
`0x00002A2C` (GPIO44/RX and GPIO42/TX), and pin-function words
`0x00000004, 0x00000004, 0, 0`. MRAM wired recovery additionally requires
the control word's master field to be `0x6` and its wired-recovery bit to be
set. These values are a matching hypothesis for a retail dump, not evidence
that all G2 temples were provisioned this way. A positive result establishes
only a restore candidate; Ambiq's documented UART host does not provide
installed-MRAM readback.

## Requirements

- A current desktop version of Google Chrome, Microsoft Edge, or another
  Chromium browser with Web Serial enabled.
- HTTPS when using a hosted copy, or `localhost` during development.
- An Even Realities G2 charging case.
- Both Smart Glasses temples seated and running for the combined backup.
- A USB-C **data** cable, not a charge-only cable.
- Stable USB power for the entire backup or recovery operation.

The browser should offer a serial device with USB ID `1A86:7523`. Depending on
the operating system, it may appear as a CH340/CH341 device or as
`/dev/cu.usbserial-*`.

## How the webflasher works

### 1. Factory-console analysis

The case is opened at 1,000,000 baud, 8 data bits, no parity, and 1 stop bit.
The webflasher uses only the read-only factory commands:

| Command | Purpose |
| --- | --- |
| `DEA0` | Case model and firmware version |
| `DEA2` | Eight-byte factory identifier |
| `DEA3` | Battery, lid, USB, glasses-presence, and temperature telemetry |
| `DEA4` | Scalar case state |

Analysis exposes only those read queries. The separate, user-invoked glasses
check exposes `DEB0`, a traced reversible hardware reset of both temples; no
provisioning, PMIC-repair, ship-mode, or other factory controls are exposed.

### 2. ROM-loader inspection

The webflasher changes the case's USB control signals to enter the immutable
STM32 ROM loader at 115,200 baud, 8 data bits, even parity, and 1 stop bit. It
then verifies the expected product ID, reads the 128-byte option block, and
inspects both 256 KiB flash banks.

The option bytes determine which physical bank is mapped as the running bank.
The UI reports the active and inactive physical-bank numbers rather than
assuming that a fixed address always means the same physical bank.

### 3. Running-temple read bridge

After the case reports the selected temple as present and the user confirms it
is seated, the webflasher:

1. enters the immutable case ROM loader;
2. verifies the pinned bridge SHA-256;
3. clears the retained proof/result regions;
4. writes and reads back all 1,712 bridge bytes at `0x20010000`;
5. executes one embedded status or version request;
6. validates the USB reply and the temple frame;
7. re-enters the ROM loader and verifies retained operation, route, byte
   counts, zero UART errors, all router masks, and byte-for-byte YHM restore;
8. clears and rereads both retained regions; and
9. returns to the stock case application.

The bridge writes case SRAM, not flash or option bytes. It writes no persistent
temple state. If the YHM baseline represents an active or non-allowlisted
charging route, it returns status 3 before selecting a route or transmitting.
SybilSight physically validated the payload and host protocol with its Python
runner; this Web Serial port follows the same gates but has not yet been
exercised by this repository on connected G2 hardware.

### 4. Guarded running-temple CFW writer

For the exact reviewed CFW only, the webflasher loads the separately pinned
2,872-byte bridge at `0x20010000`. It first requires case firmware 1.2.57,
fresh seated-route telemetry, the complete CFW bundle SHA-256, the Apollo-main
payload SHA-256, hardware revision 5, and explicit user confirmations.

The host uses 32-byte stop-and-wait USB chunks, never retries start or header,
retries only the identical CRC-protected data record up to two times, and
settles for 100 ms at every 6-KiB parser handoff. Success additionally
requires the exact `0x55` acknowledgement and a checksum-valid postflight
version. It then exits the bridge, binds the retained proof to the route and
final host sequence, verifies all ten YHM registers were restored
byte-for-byte with zero UART errors, clears and rereads the volatile evidence,
and requires the normal case 1.2.57 banner.

Any missing transaction or cleanup proof is reported as
`failed_or_uncertain`. The next selected route is not attempted. No bridge
operation erases or writes case flash, case option bytes, the Apollo
bootloader, or peripheral firmware.

### 5. Combined Case + Smart Glasses preservation backup

Before recovery, the tool:

- reads all 524,288 bytes from `0x08000000` through `0x0807FFFF`;
- reads all 128 option bytes at `0x1FFF7800`;
- queries a checksum-valid firmware/hardware version frame from each seated
  temple through the reviewed read-only SRAM bridge;
- requires the left and right firmware versions to match; and
- downloads, reparses, size-checks, and SHA-256-checks the matching official
  `EVENOTA` archive before embedding it in the backup.

The downloaded `.g2-backup.json` contains base64-encoded case memory,
SHA-256 hashes, case firmware and bank state, both raw temple-version frames
and route-restoration proofs, and the complete official glasses recovery
bundle. Treat it as private device data.

The case portion is a byte-for-byte installed-state backup. The Smart Glasses
portion is a live identity snapshot plus a validated recovery image for the
reported release; it is not a readback of installed Apollo MRAM, the separate
installed bootloader, keys, pairing state, calibration, or INFO0/INFOC.

### 6. Firmware validation

For an official `EVENOTA` bundle, the browser validates:

- bundle topology, component names, types, offsets, and lengths;
- the fixed `evenota\0` table trailer and contiguous close at end-of-file;
- every component's non-reflected CRC32C;
- the Apollo main-image size, flags, reserved words, CRC-32, type `0xCB`,
  target `0x00438000`, install-region boundary, and vector;
- the Apollo bootloader region boundary and vector when present;
- the charging-case component's `EVEN` wrapper and additive checksum;
- the raw case image's Cortex-M vector table;
- the archive size and SHA-256 when loaded from the hosted catalog; and
- the offline application-alive pogo transfer record count, final sequence,
  final payload size, and 6,000-byte batching plan for each component.

Standalone wrapped or raw case images receive the applicable case-image
checks. Invalid or oversized images are rejected before writes are enabled.
Successful integrity checks are reported separately from publisher trust.
Only a complete pinned digest identifies an archived official image or the
reviewed CFW.

### 7. Inactive-bank staging

Staging erases only the pages required by the selected case image in the
currently inactive physical bank. It does not mass-erase the MCU, overwrite the
active bank, or erase the device-data pages at bank offsets `0x3F000` and
`0x3F800`.

The image is written in ROM-loader blocks, read back, and compared
byte-for-byte and by SHA-256.

### 8. Bank activation

Activation is separate from staging. The tool rereads the inactive bank,
confirms it still matches, rereads the option bytes, and refuses to continue if
the device state changed.

The user must confirm that the backup was stored and type:

```text
ACTIVATE CASE BANK
```

Only then does the webflasher toggle `nSWAP_BANK` while preserving the rest of
the option block. The case resets, returns to its normal application, and is
analyzed again.

## Using the webflasher

### Analyze a case

1. Open the webflasher in a supported desktop browser.
2. Connect the G2 case with a USB-C data cable.
3. Click **Connect & analyze case**.
4. Select the CH340/CH341 serial device in the browser prompt.
5. Wait for the factory-console and ROM-loader passes to complete.
6. Review the case state, identifiers, bank mapping, and firmware versions.

Analysis is read-only. The case may reset while the tool changes between the
normal application and ROM-loader modes.

### Reset and recheck the glasses

1. Insert the left and right temples into the case.
2. Click **Reset both temples & recheck**.
3. Wait for the case to confirm `reset gls L & R, reason: cmd`.
4. Review `GLS_L` and `GLS_R` after their application links return.

This is the physically traced case reset path and does not write firmware.
Live testing found no separate G2 recovery/DFU advertisement across this reset
while the temples were seated.

The 2026-07-25 recovery session validated its practical recovery value. Before
the reset, Case 1.2.57 reported `GLS_L=0, GLS_R=1` and the left application
did not answer. The fixed dual-route reset restored `GLS_L=1, GLS_R=1`; a
read-only bridge then returned left firmware 2.2.6.10/hardware 5, and both
displays worked. No firmware bytes were sent in that recovery sequence.

It also does not invoke the application-alive `0x52...0x55` pogo OTA wrapper;
the stock case has no USB forwarding route to it.

### Query a running temple

1. Analyze the case and confirm the selected left or right temple is reported
   as present.
2. Under **Volatile read-only bridge**, select either firmware/hardware
   version or battery/voltage status.
3. Confirm the temple is seated and leave USB connected.
4. Click **Run read-only probe**.
5. Review the decoded result and raw checksum-valid temple frame.

Each click performs one fixed request and returns to stock case firmware. If
the tool reports a non-idle YHM baseline, let stock charging activity settle
and retry. This control cannot emit arbitrary bytes or install official or CFW
firmware.

### Restore a pinned main image on running temples

1. Analyze case firmware 1.2.57 with the glasses seated and both desired
   routes reported present.
2. Load a hash-pinned stock or reviewed-CFW bundle from the catalog or disk.
3. Under **Guarded running-temple reinstall**, select both routes or one
   explicit route. Both runs right first and then left; each route gets a
   fresh volatile bridge session and complete cleanup.
4. Confirm the glasses are seated, accept the single-slot risk, and type
   `FLASH GLASSES FIRMWARE`.
5. Keep the case powered, the lid and glasses still, and the browser awake
   until the audit reports success or `failed_or_uncertain`.
6. Download the audit JSON. Do not treat a same-version postflight reply alone
   as proof of CFW; stock and CFW both report 2.2.6.10.

After every selected route and Case 1.2.57 return are verified, the web
flasher sends `DEB0` as the final temple-mutating command. It waits for every
selected contact to return, performs checksum-valid read-only version probes,
and verifies the Case application again. The audit is successful only if this
`finalResetAndLiveness` phase succeeds. Version is liveness evidence; the
complete image and Apollo-main hashes remain provenance.

For a failed or uncertain transfer, the same reset is attempted only when
every attempted route has verified route cleanup and Case 1.2.57 return. The
original transfer outcome remains failed or uncertain. If cleanup is not
verified, the flasher does not send the reset.

This is an application-alive reinstall path. If the temple no longer answers
the version preflight, do not attempt it repeatedly: use a separately proven
SBL/MRAM-recovery or SWD route.

### Inspect dead-temple recovery provisioning

1. Acquire INFOC and the selected active INFO0 through a read-only debugger
   session. This webflasher cannot acquire either dump through the stock case.
2. Under **Offline dead-temple candidate**, choose the INFOC dump beginning at
   `0x400C2000` and the active INFO0 dump beginning at offset zero.
3. Review the exact pogo-field match, receive window, SBL restore candidate,
   GPIO override, and MRAM wired-recovery result.

The files remain in the browser. The decoder has no serial or programming
path, and a positive result is not authorization to send an SBL image.

### Recover the charging case

1. Analyze the case.
2. Seat both temples, refresh analysis, click **Back up case + Smart Glasses**,
   and store the downloaded recovery set privately.
3. Select a version from the hosted official archive, or choose a local
   case-compatible firmware file. The reviewed CFW entry is not
   case-recovery-compatible.
4. Confirm the displayed bundle, case version, size, and integrity results.
5. Click **Stage & verify inactive bank**.
6. Do not disconnect or remove power during erase, write, or readback.
7. Review the staged-bank verification result.
8. Check the backup confirmation, type `ACTIVATE CASE BANK`, and activate.
9. Wait for the case to reset and for the fresh analysis to finish.

If staging fails, the original active bank remains selected. Do not attempt
activation unless staging and readback both completed successfully.

## Python flashing tools

Install the Python tool's only external dependency:

```bash
python3 -m pip install -r scripts/requirements.txt
```

The case-USB tool performs the same reviewed-CFW, running-temple operation as
the browser. Offline inspection opens no hardware:

```bash
python3 scripts/g2_case_pogo_flasher.py inspect \
  /path/to/g2-2.2.6.10-cfw.bin
```

A read-only preflight loads the volatile bridge, queries one running route,
proves YHM restoration, clears the retained evidence, and returns to case
1.2.57:

```bash
python3 scripts/g2_case_pogo_flasher.py preflight \
  --device /dev/cu.usbserial-XXXX \
  --route right \
  --glasses-seated-confirmed
```

To flash the exact reviewed CFW main on both routes:

```bash
python3 scripts/g2_case_pogo_flasher.py flash-reviewed-cfw \
  /path/to/g2-2.2.6.10-cfw.bin \
  --device /dev/cu.usbserial-XXXX \
  --routes both \
  --glasses-seated-confirmed \
  --execute-main-ota \
  --accept-single-slot-risk \
  --confirm-image-sha256 \
  5c1539fd39c599e6035f6a8ec0779ba687c250d342a24c21a39952fed6c56aa0 \
  --log /path/to/g2-cfw-flash-audit.json
```

The tool rechecks case 1.2.57 and fresh selected-route presence before loading
the writer. It independently verifies the bridge, complete bundle, and main
payload hashes, every SRAM write, hardware revision 5, every OTA reply, final
accepted size/sequence, retained route restoration, volatile cleanup, and
normal case return. Any missing proof is failure or uncertain state.

`scripts/g2_pogo_flasher.py` provides the same main-only host for an
independently validated raw 1-Mbaud temple UART. Do not point that direct-UART
tool at the stock case CH340; use `g2_case_pogo_flasher.py` for the retail
case USB connection. Neither path backs up Apollo MRAM or recovers a temple
whose application/UART task is already dead.

## Firmware archive

The archive builder knows about all 12 official G2 releases evidenced by the
SybilSight research plus the reviewed 2.2.6.10 CFW:

```text
2.0.1.14  2.0.3.20  2.0.5.12  2.0.6.14
2.0.7.16  2.0.8.20  2.0.9.20  2.1.1.8
2.1.1.12  2.2.0.24  2.2.4.34  2.2.6.10
2.2.6.10-cfw
```

It retrieves each original bundle from the Even Realities CDN. If a known CDN
object is unavailable, it checks the preserved evidence paths under
`~/Repo/SybilSight-v2` and `~/Repo/SybilSight`.

Run it with:

```bash
npm run archive:firmware -- --output ./firmware-archive/source-files
```

Each version directory contains the original bundle, every extracted
component, a raw case image, `metadata.json`, and `SHA256SUMS`:

```text
source-files/
  index.json
  2.2.6.10/
    e28738432d7b612d625331b00383149b.bin
    firmware_codec.bin
    firmware_ble_em9305.bin
    firmware_touch.bin
    firmware_box.bin
    firmware_box.raw.bin
    ota_s200_bootloader.bin
    ota_s200_firmware_ota.bin
    metadata.json
    SHA256SUMS
  2.2.6.10-cfw/
    g2-2.2.6.10-cfw.bin
    cfw_patches-2.2.6.10.json
    firmware_codec.bin
    firmware_ble_em9305.bin
    firmware_touch.bin
    firmware_box.bin
    firmware_box.raw.bin
    ota_s200_bootloader.bin
    ota_s200_firmware_ota.bin
    metadata.json
    SHA256SUMS
```

The CFW entry is accepted only when its full digest, the patch recipe's
stock/output digests, and all 16 reviewed operations match the pinned trust
boundary.

The archive itself is intentionally excluded from Git.

## Local development

Node.js 22.13 or newer is required.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Available commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server on port 3000 |
| `npm test` | Run firmware-parser and safety tests |
| `npm run test:python` | Run the offline Python protocol/transport tests |
| `npm run build` | Create the static production build in `dist/` |
| `npm run check` | Run tests followed by the production build |
| `npm run preview` | Serve the production build locally on port 4173 |
| `npm run archive:firmware` | Build the verified firmware archive |

## Deployment

The production build is static and can be served by any HTTPS host:

```bash
npm run build
```

The repository includes
[`deploy/webflasher.caddy`](deploy/webflasher.caddy), which serves:

- the application from `/share/webflasher`; and
- `/firmware-updates/*` from `/share/sybilsight`.

The example also applies a content security policy, security headers, SPA
fallback, catalog revalidation, and immutable caching for versioned firmware
files.

## Project structure

```text
src/App.jsx                    Guided recovery interface
src/lib/backup.js              Combined case/glasses recovery artifact builder
src/lib/serial.js              Web Serial and STM32 ROM-loader transport
src/lib/firmware.js            Bundle, checksum, image, and option-byte logic
src/lib/pogoBridge.js          Pinned read-only SRAM bridge and proof validation
src/lib/pogoFlashBridge.js     Pinned main-only write bridge and protocol gates
scripts/build-firmware-archive.mjs
                               CDN mirroring and archive extraction
scripts/g2_pogo_flasher.py     Raw 1-Mbaud temple-UART flasher
scripts/g2_case_pogo_flasher.py
                               Case-USB reviewed-CFW flasher
scripts/g2_case_rom.py         Safety-scoped volatile-SRAM ROM primitives
tests/firmware.test.mjs        Parser and safety tests
tests/backup.test.mjs          Combined recovery artifact tests
tests/pogo-flash.test.mjs      Write-bridge and OTA protocol vectors
deploy/webflasher.caddy        Production Caddy site block
public/even-g2-case-grey.png   G2 product image
```

## Safety and privacy

- Back up the complete case and both seated Smart Glasses before every staging
  attempt.
- Keep the case powered and connected throughout a write operation.
- Leave the case connected throughout a volatile pogo diagnostic so its
  retained restore proof can be checked and cleared.
- Never use a backup from one case as another case's device-data image.
- Do not publish `.g2-backup.json` files; they can contain identifiers,
  provisioning data, live temple snapshots, and embedded firmware.
- A successful parser or build test is not a substitute for hardware
  validation.
- This software is provided without warranty under the MIT License.

## Troubleshooting

**The connect button says Chrome or Edge is required**

Web Serial is unavailable in the current browser. Use a current desktop
Chromium browser and load the app over HTTPS or from `localhost`.

**The case does not appear in the serial picker**

Try a known USB-C data cable, reconnect the case directly rather than through a
hub, and confirm that the operating system recognizes the CH340/CH341 device.

**Analysis times out after a reset**

Reconnect the cable, close other applications that may own the serial port,
choose the device again, and rerun analysis. Do not proceed with recovery from
a partial report.

**The case disconnects during activation**

A reset immediately after option-byte programming is expected. Wait for the
tool to reconnect and complete the fresh analysis. If it cannot, disconnect and
reconnect the case, then analyze it without starting another write.

## License

Licensed under the [MIT License](LICENSE.md).

The G2 product image is a user-supplied Even Realities CDN asset and is not
granted additional rights by this repository's MIT license.
