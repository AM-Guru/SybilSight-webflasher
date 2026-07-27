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
- Uses the traced stock `B0` command to reset both seated temples, closes the
  reset-confirmation console, then retries fresh Case sessions until their
  links and presence telemetry return.
- Runs the exact reviewed, read-only USB-to-pogo SRAM bridge for left/right
  temple status or firmware/hardware version, with retained transport and
  YHM-restoration proof.
- Computes the recovered `0x52...0x55` pogo OTA record plan for every
  component in a selected official or reviewed-CFW bundle without emitting
  any OTA command, and explicitly marks the Apollo bootloader as omitted.
- Transfers only the exact reviewed CFW or pinned official Apollo-main payload
  to a selected running temple through the hardware-validated volatile
  case-USB bridge.
  The browser requires fresh presence telemetry, independent bundle/main/
  bridge trust pins, explicit risk confirmations, exact per-record replies,
  postflight liveness, retained route-restoration proof, volatile-data
  cleanup, and normal case 1.2.57 return.
- Offers a hash-pinned **Flash differences** mode for the exact Stock
  2.2.6.10 ↔ reviewed-CFW pair. It compares every bundle component, omits the
  five byte-identical components, and transfers the one changed Apollo-main
  component with the same complete CRC/finish/reset verification as a normal
  reinstall.
- Opens in **Easy Mode** at the site root: select the Case, choose Stock or
  CFW, leave the default **Update** mode selected (or choose **Restore**),
  optionally update older Charging Case firmware first, and click **Apply**.
  One shared automation pipeline performs the fresh
  preflight, catalog/image validation, bilateral right-then-left operation,
  bounded cleanup/recovery, final `DEB0` reset, contact checks, and
  checksum-valid liveness verification without mid-process prompts.
- Keeps the existing multi-pane console as **Advanced Mode**, including all
  manual analysis/recovery controls, and adds the same Update/Restore selector
  and automatic **Apply** action beneath its firmware menu.
- Presents both recovery targets under Recover: three-step inactive-bank
  staging/activation for the charging case and a separately gated left,
  right, or both-temple reinstall for responsive Smart Glasses.
- Decodes read-only Apollo510 INFOC and active INFO0 debugger dumps locally,
  then fails closed unless every known SBL UART field matches the pogo route.
- Provides a floating, downloadable **Show Console Log** under Recovery,
  including operation lifecycle, bounded progress milestones, device transport
  messages, and browser failures.
- Shows operation-count progress and the current task in the right-hand footer
  for every analysis, backup, probe, staging, activation, reset, and restore.

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

“Flash differences” does not mean sparse arbitrary-address programming. The G2
OTA receiver has no block index, destination offset, or installed-MRAM readback:
it accepts one contiguous component stream and validates the complete
component CRC at finish. Skipping changed ranges within
`ota/s200_firmware_ota.bin` would shift or truncate the staged image. The safe
difference unit is therefore a complete changed component; byte-identical
components are the only data omitted from the wire operation. Automatic
Update falls back to the complete pinned target main whenever the exact
differential source is not proven.

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
  `d2fb5dcef485b1bb14818b8dc56811b9d278d6fc2b81e56c496c53b72aaa1e86`
- patch-manifest SHA-256:
  `47b33307da30d08480f226ee519a0c10d20288cbb411695e9a3fc45eaee5a0a2`
- 23 expected-byte-gated operations, including one appended code blob,
  three same-length `2.2.6.10` → `2.2.6.11` identity fields, and
  the required inner/outer size and checksum updates

It reports numeric version `2.2.6.11` while retaining `2.2.6.10` as its Stock
base, and advertises `EVENCFW/3 img576 imgz rle wakelease`. The version is a
Stock/CFW routing gate; the marker and pinned hashes remain the authenticity
gates.

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

The reviewed browser-safe bridge is exactly 1,720 bytes with SHA-256
`e30e143d522e5a5d0b10a92a15610badcc6aef014333716a94eae183b14dc258`.
It accepts only status, version, or a no-contact exit self-test. All successful
route reads/writes and transmit counts matched, the starting YHM image was
restored byte-for-byte, the retained proof/result regions were cleared, and
stock case firmware 1.2.57 resumed normally. A non-idle charging-route image
was also physically observed to fail closed before transmission.

The webflasher keeps this fixed read bridge for diagnostics and separately
embeds the exact reviewed 2,952-byte V7 write bridge
(`eba56380f04bf00ad9d87dffbc40c3292ec5b3cee458d3607c8cffd0dcbe335b`).
Neither path is an
arbitrary USB-to-pogo sender. The writer's SRAM code permits only the version
query and Apollo-main `0x52...0x55` state machine, while the browser
independently permits only the pinned Stock 2.2.6.10 and reviewed CFW bundles
and their exact main payloads.

The shared fail-closed host validates the complete bundle, permits only the
Apollo main component, never blindly replays `0x52` start or `0x53` header,
and never replays `0x54` DATA after any failure. Hardware returned explicit,
unadvanced DATA rejections at records 349, 753, 874, and 1,663; same-record
retries after 15, 30, and 60 seconds all produced no complete frame. The Case
path now ends that component attempt, proves Case/YHM cleanup, issues the
bilateral reset, verifies both contacts and applications, and begins a fresh
component from START. It permits three total component attempts. Missing,
malformed, or timed-out replies are also never replayed. Together with the
upstream `g2flash.py` observation that this grammar carries no destination
block index, this keeps DATA recovery fail-closed. The host also requires one fresh
checksum-valid read-only version reply immediately before the first OTA
command, waits 1 second at each 6-KiB handoff, increases that to 2 seconds
after 75%, and doubles both values for a restarted component. The final DATA
record gets a 15-second settle, or 30 seconds on a restarted component, with
host-only keepalives. Success requires both the checksum-valid zero-status
`0x55` reply and postflight liveness. A terminal failure preserves a
failed/uncertain audit, restores Case/YHM state, and performs the final
bilateral reset when cleanup is proven.

The 2026-07-26 speed qualification rejected a larger Case storage batch. A
12-KiB `balanced-lab` right-Stock run received an explicit DATA rejection after
691,000 accepted bytes, with zero temple UART errors and exact cleanup. A fresh
6-KiB conservative run then accepted all 3,524 Stock-main records and
3,523,396 bytes, FINISH/postflight, exact YHM restoration, Case 1.2.57 return,
and final bilateral reset/liveness. It took 1,571 seconds. Consequently:

- Update uses the complete changed-component plan and transmits zero unchanged
  components when installed provenance is trusted;
- Stock 2.2.6.10 ↔ CFW 2.2.6.11 sends only the complete target Apollo main;
- Restore remains the complete reviewed-image operation;
- Case USB retains the 6-KiB deferred-write boundary; and
- `balanced-lab` remains explicit-risk research, not a faster default.

A fresh whole-component retry may use the hardware-qualified
`conservative-retry` profile: the batch remains 6 KiB while settle intervals
double to 2/4 seconds and the final settle becomes 30 seconds. It is valid only
after exact cleanup, bilateral reset/contact/liveness proof, and a new START;
the rejected DATA record is never replayed.

The first 100-query gate was retired after a fresh hardware comparison showed
the live left route fail at query 52 and the already verified-stock right
route fail at query 53, both with zero UART error flags. Slowing the left probe
to 250 ms moved the failure to query 15, showing an elapsed app-mode route
window rather than a left-contact-specific query count. A later controlled
session then reproduced a missing START after the replacement 10-query gate,
while the identical START was acknowledged after one fresh version query.
Repeated probes were therefore consuming the route they were intended to
validate. The replacement is a single just-in-time checksum-valid liveness
query.

The first Bluetooth-off left restore iteration then exposed a separate CH340
idle-boundary defect before any OTA payload reached the temple. Retained bridge
state showed `ota_state=0`, zero declared/accepted bytes, and a host-header
timeout after exactly five of ten bytes. Both the Python and browser writers
therefore flush transaction headers as two paced five-byte writes; payload
flow control and all non-idempotent replay prohibitions remain unchanged. A
read-only transition then proved that the former two-second drain outlived the
selected app-mode route, while 250 ms retained a checksum-valid reply. The
pre-start drain is therefore 250 ms.

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

The reviewed case-write bridge source now lives alongside the SybilSight host.
Its V4 build gives allowlisted START, HEADER, DATA, and FINISH requests a
longer bounded temple-response capture window while retaining the short window
for read-only requests, and rejects a mutating setup when the Case idle-route
phase does not match the selected temple. It assembles to the declared 2,920
bytes with
SHA-256
`9ab41ffe1b906869b264c9ba3aa739f3bda0ee8bf0051cf67679c204dd86ac2c`.
The earlier V3 bridge completed CFW attempt 6 on the right:

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

That explicit rejection exposed one narrowly safe retry case missing from the
original host policy: a rejected record does not advance the temple's expected
sequence, so the exact CRC-protected record can be retried once after the
6.5-second deferred-storage window. A lost, malformed, or timed-out reply is
ambiguous and is never replayed. Start, component-header, and finish
transactions also remain non-replayable.

Attempt 9 then completed the left-temple transfer using the same pinned bridge
and reviewed CFW. All 3,539,474 bytes were accepted in 3,540 records with zero
retries, the `0x55` finish acknowledgement arrived, and postflight reported
firmware 2.2.6.10/hardware 5. The retained result recorded status zero,
complete baseline/selected/restored masks, byte-for-byte YHM restoration, and
normal case firmware 1.2.57 return.

A later integrated-Chromium Stock-to-CFW difference test exercised the
production artifact through the corrected local UI. The plan skipped five
byte-identical components and selected the complete changed Apollo main after
finding 16,117 differing byte positions. The first run exposed a browser-only
defect: `serial.js` handled an explicit DATA rejection using
`TempleRejectedError` without importing that class. The run stopped without
`FINISH`, restored the Case, and completed bilateral reset/liveness
verification. The missing import was fixed and covered by a regression test
that distinguishes an explicit rejection from a missing or malformed reply.

The corrected run then completed the right CFW installation: all 3,540 records
and 3,539,474 bytes were accepted, `FINISH` was acknowledged, postflight
reported 2.2.6.10/hardware 5, all YHM registers were restored, and Case 1.2.57
returned. On the left, DATA record 2,800 was explicitly rejected after
2,799,000 accepted bytes. The host waited 6.5 seconds and replayed that exact
unadvanced record once; the replay produced no complete temple response, so
the host stopped without `FINISH`. Two later fresh left-only setups, including
one after a 90-second settle, failed closed at status 3 before transmitting
firmware. The final standalone `DEB0` reset reported both contacts and
checksum-valid application replies. The tested device therefore ended with
hash-proven reviewed CFW on the right and its previously proven official Stock
installation on the left.

A 2026-07-26 repeat selected only the still-Stock left route. Case 1.2.57,
left-route presence, the pinned CFW hashes, and the five-skipped/one-changed
difference plan all passed. The volatile writer then exhausted four bounded
setup attempts because every YHM baseline was outside the reviewed
mutation-compatible seated-idle allowlist. The stop occurred before START:
zero firmware bytes were accepted and no OTA mutation began. The retained
result did not prove a complete route restoration, so the browser correctly
withheld automatic continuation and did not loop another flash. Case 1.2.57
returned, and the standalone `DEB0` reset/recheck subsequently confirmed both
contacts and checksum-valid application liveness.

This result does not justify widening the YHM allowlist. `GLS_L=1` proves
presence, not a safe router phase. Audits now retain the bounded setup-attempt
count, `otaMutationAttempted=false`, zero accepted firmware bytes, and a
specific `yhm_setup_non_idle_zero_byte_boundary` recommendation. After this
signature, keep the current Stock/CFW provenance, stop wired setup retries,
and make the standalone bilateral reset/recheck the final hardware mutation.

A later default-behavior test selected the newest official Stock bundle,
**Both temples**, and **Complete pinned Apollo main** without changing any
recovery selector. The right route accepted records 1–338, explicitly rejected
record 339, then returned no complete response to the one permitted exact retry
after 6.5 seconds. The host stopped without FINISH and did not begin the left
route. Case/YHM cleanup was verified, so the automatic final `DEB0` ran and
checksum-valid liveness passed on both sides. The result is not a Stock
installation proof: the right image provenance is failed/uncertain, while the
unattempted left retains its previously verified official Stock provenance.
The recovery proof card now displays the selected target's own byte and record
count rather than the historical reviewed-CFW count.

Local Vite development now proxies versioned, immutable
`/firmware-updates/source-files/2…` artifacts to the production WebFlasher
origin. The catalog remains local, while missing generated archive binaries no
longer fall through to Vite's `index.html` and fail later as an unsupported
firmware file.

A later failed-OTA recovery added one more hardware result. The right display
worked, but the Case initially reported `GLS_L=0, GLS_R=1` and the left
application did not answer. The fixed reset probe reproduced the stock
dual-route reset waveform, restored its captured YHM image byte-for-byte, and
returned Case 1.2.57. Fresh telemetry then reported both contacts; a
checksum-valid left version reply decoded as 2.2.6.10/hardware 5, and the user
confirmed both displays working. That recovery sent no firmware bytes, so it
validates reset-and-liveness recovery—not an official-image transfer.

The subsequent 2026-07-25 rollback incident produced the first completed
case-USB official-image restore: the right temple accepted all 3,524 records
and 3,523,396 pinned stock bytes, returned firmware 2.2.6.10/hardware 5, and
the Case restored its YHM baseline byte-for-byte. The left data path became
intermittent despite `GLS_L=1` and normal charging voltage. It accepted 85,000
bytes on one attempt, then later read-only sessions lost complete frames at
queries 5, 41, and 81 with zero UART error flags. Presence/charging therefore
does not prove a reliable pogo data contact.

The browser and Python implementations now parse `GLS_L`/`GLS_R` from the
Case's `A3` line even when `otaGls` is absent (`otaGls` is reported separately
on `A4` by the tested Case), enforce the just-in-time liveness query before any
OTA mutation, and retain the validated final dual-reset/contact/version phase.
Case USB completed the pinned official Apollo-main transfer on the right. The
left product-test path remained unreliable after its interrupted 85,000-byte
session even with phone Bluetooth disabled: multiple fresh sessions sent START
but accepted zero header/data bytes. A fresh local BLE connection using the
reviewed upstream `g2flash.py` then completed all six pinned official
components: 1,053 status-zero block ACKs, six END status-8 (`UPDATING`)
verifications, zero
resends, and all 861 Apollo-main blocks. The prescribed final `DEB0` reset
subsequently returned checksum-valid 2.2.6.10/hardware-5 replies from both
temples. Application-dead recovery remains unproven.
Both continue to mark the Apollo bootloader component **OMIT FROM POGO** until
an independent SBL, MRAM-recovery, or SWD route is proven.

A later Chromium/Python recovery cycle isolated the remaining Case-path
timeout. Production Web Serial first failed because a CH340 packet contained
one ROM ACK plus only 31 data bytes; the local host now abandons that partial
transaction, re-enters the loader, and completes all option, flash, and SRAM
reads in 31-byte requests. With that correction, integrated Chromium completed
Case analysis, a full 512-KiB Case backup, and checksum-valid left/right
2.2.6.10/hardware-5 probes.

The V4 DATA capture window then crossed the former Stock failures at 829,000
and 840,000 accepted bytes and completed the right Stock main: 3,523,396
bytes, 3,524 records, zero retries, FINISH acknowledgement, postflight
liveness, YHM restoration, and Case 1.2.57 return. The left V4 session accepted
823,000 bytes before an ambiguous no-frame result and therefore did not send
FINISH or replace the previously proven six-component Stock installation.
The final `DEB0` reset was confirmed after all attempts; fresh Chromium probes
then returned the same checksum-valid 2.2.6.10/hardware-5 frame from both
temples.

V6 extends the bounded START/HEADER/DATA/FINISH receive loop to
`0x04000000`, retains the 2,920-byte SRAM layout, and supports exact
bidirectional phase adaptation between the five allowlisted seated-idle YHM
baselines. An integrated Chromium Easy Mode run completed the official Stock
main on both temples. The right accepted all 3,524 records on its first V6
attempt. The left explicitly rejected its first attempt, so the host performed
verified cleanup, bilateral reset and liveness, then restarted the whole left
component with doubled pacing; all 3,524 records, FINISH, postflight, YHM
restoration, and Case 1.2.57 return passed. The final `DEB0`, both contacts,
and both checksum-valid 2.2.6.10/hardware-5 replies passed. A following
default Easy Mode Stock Update transmitted zero firmware bytes because the
saved bilateral audit already proved the selected target; its reset/liveness
verification also passed.

One later Case reported the previously unseen YHM baseline
`811004aeaf03812033ff`. The mutation bridge correctly rejected it before route
selection with status 3, zero selected/restored/write masks, zero temple
transactions, and zero accepted firmware bytes. The host does not add that
state to the mutation allowlist. It now verifies and clears that exact
zero-write retained record, returns to Case 1.2.57, performs a bounded
bilateral `DEB0` reset and liveness check, and retries only from a fresh route
setup. If the baseline remains outside the five reviewed states after the
bounded resets, flashing still stops with no OTA mutation.

For offline analysis, selected `EVENOTA` bundles show the exact number of
1,000-byte `0x54` records and final sequence value for each component. The
recovered writer grammar uses an exact 128-byte component header for `0x53`,
CRC-16/CCITT-FALSE over each `0x54` data payload, a modulo-256 sequence, and
6,000-byte deferred batches. The expected sequence starts at zero. An explicit
rejection proves that the current sequence did not advance, but Case-path
hardware showed that the receiver does not recover reliably from an
in-session retry. The current host therefore replays no DATA record: after
exact cleanup and reset/liveness proof, it restarts the complete component
from START. Missing or malformed replies remain ambiguous and also abort the
component without replay. Start and header are not treated as replay-safe.
Offline calculation never contacts a temple. During a real
transfer, each acknowledgement is
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
| `DEA3` | Battery, lid, USB, glasses-presence, and temperature telemetry; the tested Case omits `otaGls` here |
| `DEA4` | Scalar case state plus asynchronous telemetry containing `otaGls` |

Analysis exposes only those read queries. The separate, user-invoked glasses
check exposes `DEB0`, a traced reversible hardware reset of both temples; no
provisioning, PMIC-repair, ship-mode, or other factory controls are exposed.

### 2. ROM-loader inspection

The webflasher changes the case's USB control signals to enter the immutable
STM32 ROM loader at 115,200 baud, 8 data bits, even parity, and 1 stop bit. It
then verifies the expected product ID, reads the 128-byte option block, and
inspects both 256 KiB flash banks.

After the browser grants access to exactly one matching `1A86:7523` Case, later
analysis and recovery operations reuse that authorized port. A chooser remains
mandatory when no matching Case is authorized or more than one is available.

CH340 reads can end after one 32-byte USB packet even though the STM32 already
returned to command mode. That packet contains the one-byte ROM ACK followed by
exactly 31 payload bytes. A timed-out block is never appended to a backup. When
the browser detects this exact boundary, it discards the prefix, closes the ROM
session, re-enters and re-identifies the immutable loader, and switches all
remaining reads to complete 31-byte requests. Other transient short reads get
bounded whole-block retries after the same fresh-session synchronization. This
prevents stale partial bytes from being mistaken for the next command
acknowledgement. On 2026-07-25 the hosted browser reproduced the deterministic
boundary repeatedly at option-memory `0x1FFF7800`, receiving 31 of 128 bytes.
The corrected live backup then found the same boundary while verifying the
volatile pogo bridge at SRAM `0x20010000` (31 of 256 bytes), so the adaptive
reader is used for flash, option memory, retained proof, and bridge readback.
Read-only temple probes also use bounded fresh-loader synchronization retries;
the first retry run showed that a Case can still be returning from the backup
console when the immediately following probe first asserts the loader signals.
After the verified SRAM jump, both read-only and writer bridges release BOOT0
before Web Serial changes framing. The Python flasher and the browser writer
already did this; the 2026-07-25 browser backup exposed and corrected the
missing release in the read-only probe.

The browser bridge now keeps the ROM loader's `115200 8E1` framing and one
continuous Web Serial session through the SRAM `GO`, banner, and host request.
This avoids a CH340 close/reopen reset boundary. Read-only route-phase status
`3` remains fail-closed, but the session may wait for charging activity to
settle and retry up to three times with a fresh fixed bridge; no temple request
is transmitted until the YHM baseline matches the allowlist.

The option bytes determine which physical bank is mapped as the running bank.
The UI reports the active and inactive physical-bank numbers rather than
assuming that a fixed address always means the same physical bank.

### 3. Running-temple read bridge

After the case reports the selected temple as present and the user confirms it
is seated, the webflasher:

1. enters the immutable case ROM loader;
2. verifies the pinned bridge SHA-256;
3. clears the retained proof/result regions;
4. writes and reads back all 1,720 bridge bytes at `0x20010000`;
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
runner. Integrated Chromium has exercised the read-only path and a CFW write
that failed closed before FINISH; retain the audit for every browser write.

### 4. Guarded running-temple CFW writer

For the exact reviewed CFW or official recovery package, the webflasher loads
the separately pinned 2,952-byte V7 bridge at `0x20010000`. It first requires
case firmware 1.2.57. Automatic Apply enables **Update Charging Case first**
by default; when needed it stages the latest official Case image in the
inactive bank, verifies it byte-for-byte, activates it, and re-analyzes the
Case,
fresh seated-route telemetry, the complete CFW bundle SHA-256, the Apollo-main
payload SHA-256, hardware revision 5, and explicit user confirmations.

The host uses 32-byte stop-and-wait USB chunks and replays no START, HEADER,
DATA, or FINISH transaction. An explicit DATA rejection or ambiguous reply
ends that component attempt. After exact cleanup, bilateral reset, contact and
liveness proof, Easy Mode may begin a fresh full component, with three total
attempts and doubled pacing on restarts. V6 rejects a mutating setup before
temple transmission when the Case idle-route phase does not match the selected
side. A bilateral run may reorder left/right in either direction only from an
exact allowlisted zero-write opposite-phase proof, capped at four adaptations.
V7 also handles an observed CH340/USART1 failure in which the Case emitted
only two bytes of a response after accepting DATA. The SRAM bridge
reinitializes USART1 and retransmits only its cached checksum-framed `G2RX`
response; the browser discards the short prefix and synchronizes to that
complete frame. It never retransmits the temple DATA request. If every
host-response attempt fails, immutable-ROM readback may prove a status-16
fatal cleanup only when all route masks are complete and the ten restored YHM
bytes exactly match the allowlisted baseline. That proof permits a fresh
whole-component restart after the bilateral reset/liveness gate; it is not a
transfer-success proof.
If an intermediate or final reset returns a transient no-frame, non-idle YHM,
missing-contact, missing-telemetry, or missing-application-banner result, Easy
Mode sends one bounded second bilateral reset and repeats the read-only
contact/application gate. Wrong versions, incomplete cleanup, a second
failure, and every non-allowlisted failure still stop immediately.
Single-route Advanced repairs use the same bilateral rule: every intermediate
DEB0 gate and the final DEB0 gate verify both seated temple applications, not
only the route being rewritten.
Success additionally
requires the exact `0x55` acknowledgement and a checksum-valid postflight
version. It then exits the bridge, binds the retained proof to the route and
final host sequence, verifies all ten YHM registers were restored
byte-for-byte with zero UART errors, clears and rereads the volatile evidence,
and requires the normal case 1.2.57 banner.

If a running temple has an interrupted product-test session and repeated fresh
`0x52` START requests receive no frame while accepting zero header/data bytes,
stop retrying that state machine. Restore the Case/YHM state, issue the
bilateral reset, and prefer a fresh BLE full-component session when the arm
advertises. The July 25 left recovery established this fallback with the exact
pinned stock package. Browser and Python audits now label this exact signature
`wired_start_no_frame_zero_byte_boundary`, record that START/HEADER replay is
forbidden, and retain the fresh-BLE recommendation in the downloadable result.
The browser does not itself perform that BLE session.

Any missing transaction or cleanup proof is reported as
`failed_or_uncertain`. The next selected route is not attempted. No bridge
operation erases or writes case flash, case option bytes, the Apollo
bootloader, or peripheral firmware.

#### Stock ↔ CFW component differences

The browser loads and independently hashes both sides of the exact reviewed
pair. It requires one official and one custom bundle, the same internal
2.2.6.10 version, matching component topology, and exactly one changed
component. The offline plan reports:

- source and target bundle/main SHA-256 values;
- identical and changed component counts;
- exact byte-position difference ranges for inspection;
- the contiguous main payload size and record count that must cross the wire;
  and
- the required finish acknowledgement, accepted-byte proof, postflight
  response, final `DEB0` reset, contact return, and checksum-valid liveness.

Because stock and CFW report the same firmware version, the operator must
confirm which side of the pair is currently installed. Version replies are
liveness evidence, not CFW provenance. The target is instead bound by its
compiled-in bundle/main hashes, component CRC, exact accepted byte count, and
finish acknowledgement. Installed Apollo MRAM cannot be reread through the
stock Case route.

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
4. The browser closes that console, waits for the temple links, and retries
   explicit `DEA0`/`DEA3` queries in newly opened serial sessions.
5. Review `GLS_L`, `GLS_R`, and the checksum-valid version liveness returned
   by both read-only pogo routes.

This is the physically traced case reset path and does not write firmware.
Live testing found no separate G2 recovery/DFU advertisement across this reset
while the temples were seated.

The 2026-07-25 recovery session validated its practical recovery value. Before
the reset, Case 1.2.57 reported `GLS_L=0, GLS_R=1` and the left application
did not answer. The Case confirmed the fixed dual-route reset, but the
original serial session did not return the immediate post-reset telemetry.
Reopening the normal console restored observation of `GLS_L=1, GLS_R=1`;
read-only bridge queries then returned firmware 2.2.6.10/hardware 5 from both
routes, and both displays worked. No firmware bytes were sent in that
recovery sequence.

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

### Easy Mode and automatic Apply

The bare application URL opens in **Easy Mode**. **Advanced Mode** preserves
the original Connect, Analyze, Preserve, Choose image, and Recovery Console
panes. Both interfaces call the same automatic Apply implementation.

1. Click **Select Case** and choose the G2 Case USB Serial device.
2. Choose official Stock or reviewed CFW.
3. Leave **Update** selected, or choose **Restore**.
4. Leave **Update Charging Case first** enabled. It is on by default; no Case
   write occurs when the Case is already current, and the updater never
   downgrades a newer or unknown Case version.
5. Click **Apply** and keep the Case, glasses, and cable still.

Every Apply begins with a fresh full Case analysis, including both physical
banks and all 128 option bytes. When enabled and needed, Apply validates the
latest official Case component, stages only the inactive bank, verifies its
complete readback, activates that bank, and re-analyzes the physical-bank
mapping. The update is accepted only when `nSWAP_BANK` changed, the previously
inactive physical bank is active on the target version, and the previous
active bank remains available as the fallback. It then proves the normal
application banner and opens a separate fresh console to explicitly reissue
`DEA0` with bounded retries. Whether the Case was updated or already current,
the glasses write gate also requires level-0 read access, dual-bank mode,
consistent physical-bank aliases, a valid target-version vector in the active
bank, and a valid fallback-bank vector.

After the Case gate, Apply issues the traced bilateral `DEB0` reset and obtains
fresh checksum-valid firmware/hardware-5 replies from both temples. This
normalizes a stale charging-route phase and prevents old UI analysis or saved
browser provenance from choosing the transfer mode. If initial telemetry is
missing a seated contact, the same bounded reset is used as the recovery
attempt instead of stopping before it; the operation still stops without
transmitting firmware if the contact and application do not return. Smart
Glasses firmware bytes remain blocked until the Case, contacts, and both
running temple applications pass these checks. If the Case-update option is
off, an older Case stops at preflight with an actionable message.

Restore revalidates the selected bundle and rewrites the complete pinned
Apollo main on both temples. It starts right then left, but may reverse that
order only when the retained zero-write setup proof identifies the opposite
allowlisted Case phase. Update also writes the complete pinned Apollo main for
cross-version and unknown-source installs. It uses the component-difference
optimization only when saved audits or fresh bilateral analysis prove the
exact reviewed Stock/CFW source pair. That plan omits every byte-identical
component and transfers the one changed, complete CRC-gated Apollo main. The
receiver has no safe sparse-write offset, so Update never transmits arbitrary
changed byte ranges inside that component.

Stock reports version 2.2.6.10 and the reviewed CFW reports 2.2.6.11; installed
Apollo MRAM readback is unavailable. Saved recovery audits remain useful
source proof, but they are browser-origin-local and are not portable from a
localhost hardware test to the hosted site. For the exact reviewed Stock
2.2.6.10 ↔ CFW 2.2.6.11 pair, Automatic Update uses the difference plan only
when the fresh bilateral preflight reports the exact source version and
hardware. The plan omits five byte-identical components and transfers the
**complete** pinned target Apollo main, not sparse byte ranges. Every route
must return the same
checksum-valid source-version/hardware-5 reply immediately before its START
command. Without that proof, Update selects the complete-main path. If a saved
proof becomes stale between planning and the just-in-time preflight, Automatic
Update retries with the complete target only after proving that zero firmware
bytes were accepted, exact route restoration completed, Case 1.2.57 returned,
and the bilateral reset/liveness gate passed. Otherwise it stops. The
successful audit records the live compatibility proof and any safe fallback.

If both saved routes already prove the selected target, Apply performs only
the required bilateral reset and liveness verification. An older version,
unknown source, or saved proof outside the reviewed pair selects a complete
target-main write instead of attempting the differential path. A successful
Restore or Update saves fresh per-route proof locally, keyed by Case serial,
for later fail-closed updates.

Automatic Apply handles the reviewed failure boundaries as follows:

| Observed state | Automatic action |
| --- | --- |
| Case older than 1.2.57 | Stage 1.2.57 in the inactive bank, verify readback, switch banks, re-analyze, issue fresh `DEA0`, and recheck both vectors |
| Case option bytes, bank aliases, or fallback vector disagree | Stop before any temple reset or firmware transfer |
| One seated contact is initially missing | Issue the bounded traced bilateral reset and require contact plus application liveness to return |
| Responsive hardware-5 temples run an older version such as 2.1.1.12 | Transfer the complete pinned target main; never select Stock ↔ CFW differential mode |
| Saved proof disagrees with fresh bilateral identity | Discard the saved plan and transfer the complete pinned target main |
| Just-in-time differential preflight changes before `START` | Retry complete only with proof of zero accepted firmware bytes, exact cleanup, Case 1.2.57 return, and bilateral reset/liveness |
| Allowlisted zero-write YHM setup stop | Perform the existing bounded setup reset/recheck and retry the same route |
| First final-reset contact, telemetry, banner, YHM, or no-frame check is transient | Wait, issue one bounded second `DEB0`, and repeat the full liveness gate |
| Any transfer mutation, cleanup ambiguity, wrong hardware/version after transfer, or second reset failure | Stop closed and retain the failure audit |

The first hosted retest also exposed a pre-write phase-oscillation edge case.
A status-3 bridge setup reset can leave the Case charging task in the opposite
seated-idle phase. Changing the requested route after the following full Case
return chases that phase back and forth. The writer now keeps the requested
route fixed, waits for a verified Case 1.2.57 application return between
bounded setup retries, and only then samples the YHM baseline again. This
preserves the zero-temple-transmission boundary and lets the Case charging task
settle before any START.

### Restore a pinned main image on running temples

The default firmware selection is the numerically latest official Stock
release, independent of catalog order. Automatic Apply defaults to **Update**
and always targets **Both temples**, using the proof-gated phase-compatible
order. The Advanced Mode manual
recovery console retains its explicit **Both temples** and **Complete pinned
Apollo main** defaults; CFW, single-route, and manual difference operations
remain explicit choices.

1. Analyze case firmware 1.2.57 with the glasses seated and both desired
   routes reported present.
2. Load a hash-pinned stock or reviewed-CFW bundle from the catalog or disk.
3. Under **Guarded running-temple reinstall**, select both routes or one
   explicit route. Both runs right first and then left; each route gets a
   fresh volatile bridge session and complete cleanup.
4. Choose **Complete pinned Apollo main** or **Flash differences · Stock ↔
   CFW**. Difference mode automatically loads and hashes the opposite image,
   shows the five skipped components and one changed component, and validates
   the live source as Stock `2.2.6.10` or reviewed CFW `2.2.6.11` immediately
   before START.
5. Confirm the glasses are seated, accept the single-slot risk, and type
   `FLASH GLASSES FIRMWARE`.
6. Keep the case powered, the lid and glasses still, and the browser awake
   until the audit reports success or `failed_or_uncertain`.
7. Download the audit JSON. Treat the numeric version as identity, not exact
   byte provenance; successful audits still require pinned hashes, accepted
   byte counts, FINISH, reset, and bilateral liveness.

After every selected route and Case 1.2.57 return are verified, the web
flasher sends `DEB0` as the final temple-mutating command. It waits for every
selected contact to return, but does not reuse the reset-confirmation console:
it closes that session and makes up to three newly opened `DEA0`/`DEA3`
attempts. It then performs checksum-valid read-only version probes and
verifies the Case application again. The audit is successful only if this
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
  /path/to/g2-2.2.6.11.bin
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
  /path/to/g2-2.2.6.11.bin \
  --device /dev/cu.usbserial-XXXX \
  --routes both \
  --glasses-seated-confirmed \
  --execute-main-ota \
  --accept-single-slot-risk \
  --confirm-image-sha256 \
  d2fb5dcef485b1bb14818b8dc56811b9d278d6fc2b81e56c496c53b72aaa1e86 \
  --log /path/to/g2-cfw-flash-audit.json
```

To restore the exact pinned official `2.2.6.10` Apollo main on a selected
running route:

```bash
python3 scripts/g2_case_pogo_flasher.py flash-reviewed-official \
  /path/to/g2-2.2.6.10-official.bin \
  --device /dev/cu.usbserial-XXXX \
  --routes right \
  --glasses-seated-confirmed \
  --execute-main-ota \
  --accept-single-slot-risk \
  --confirm-image-sha256 \
  f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa \
  --log /path/to/g2-official-flash-audit.json
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
whose application/UART task is already dead. The raw-UART tool cannot issue
the Case reset: after a successful raw transfer, run the Case wrapper's
`reset-both-temples` command so bilateral `DEB0` remains the final mutation
and both routes receive read-only liveness verification.

## Firmware archive

The archive builder knows about all 12 official G2 releases evidenced by the
SybilSight research plus the reviewed CFW `2.2.6.11` image built from Stock
`2.2.6.10`:

```text
2.0.1.14  2.0.3.20  2.0.5.12  2.0.6.14
2.0.7.16  2.0.8.20  2.0.9.20  2.1.1.8
2.1.1.12  2.2.0.24  2.2.4.34  2.2.6.10
2.2.6.11
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
  2.2.6.11/
    g2-2.2.6.11.bin
    cfw_patches-2.2.6.11.json
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

Pushes to `main` run the test and build steps on the organization's
`self-hosted`, `Linux`, `ARM64`, `rpi4` GitHub Actions runner. The release is
then checksummed, staged over the runner's `homeassistant` SSH target, and
atomically published to `/root/share/webflasher/` on that host. Home
Assistant's Caddy container sees the same directory as `/share/webflasher`.
The previous release is retained at `/root/share/.webflasher-previous`.

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

**The log reports a short ROM read, such as 31 of 128 bytes**

The Web Serial CH340 path may expose only the first USB packet: one ROM ACK and
31 payload bytes. The current flasher rejects that partial block, opens a new
identified ROM-loader session, and switches to complete 31-byte requests for
the remainder of the capture. Other short-read patterns still receive bounded
fresh-session retries. If analysis still fails, reconnect the Case directly,
close every other serial client, and rerun analysis; never use or restore from
the partial result.

**The case disconnects during activation**

A reset immediately after option-byte programming is expected. Wait for the
tool to reconnect and complete the fresh analysis. If it cannot, disconnect and
reconnect the case, then analyze it without starting another write.

## License

Licensed under the [MIT License](LICENSE.md).

The G2 product image is a user-supplied Even Realities CDN asset and is not
granted additional rights by this repository's MIT license.
