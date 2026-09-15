# G2 CFW 2.2.10.12 — local manual-test candidate

This candidate rebases `jimrandomh/g2flash` commit
`d968c2ccbafb85a91d1dc4683eee77accfad3142` (Faceclaw firmware revision 3) onto
official G2 2.2.10.10. It supersedes the never-flashed 2.2.10.11 candidate,
which was built from the older b20bfb1 checkout. It has passed offline
verification; hardware status is recorded at the end of this document.

## What changed since 2.2.10.11

Upstream commits `07c0e6b`..`d968c2c` add:

- **BLE link policy**: LE 2M advertised in the startup Set Local Feature, the
  fast connection profile set to 7.5 ms min/max with latency 0, and
  `_connectParamReq_impl` forced to fast mode so the stock 60-second slow-mode
  timer no longer throttles transfers. The phone still decides whether to use
  2M PHY and whether to accept the short interval; CoreBluetooth cannot request
  either directly.
- **R1 battery forwarding**: settings field 106 (`R`,`B`,1,flags,level) and
  read-only image-handler mode 17 expose the stock ring-battery cache.
- **Compass diagnostics**: the heading notification (sid 8, command 15) gains
  optional field 100 (`C`,`M`,1, accuracy, anomalies, source, flags, 0,
  sample-tick) captured from the sensor-hub GAF output. The old global
  display-event hook is removed.
- **Numeric firmware revision**: field 100 of the settings READ response is now
  `Faceclaw/3` instead of the `EVENCFW/18 …` token list.
- **Idle-input forwarding**: while the phone holds the wake lease, single tap,
  long press and release (field 102 events 2/3/4 with the raw source) are
  reported instead of dropped.
- **Head-up wake**: the IMU head-tilt wake is reported as field-102 event 5,
  and forwarded as EvenHub sys event 12 while a page is on screen.

## Files and identity

The build writes to `work/cfw-2.2.10/candidate/`:

- `g2-2.2.10.12.bin` — complete EVENOTA bundle for local file selection.
- `cfw_patches-2.2.10.12.json` — 48 expected-byte-gated replay operations.
- `ota_s200_firmware_ota.bin` — extracted Apollo main payload, for inspection.
- `g2-2.2.10.10-address-profile.json` — reviewed address and stock-byte evidence.
- `injected-functions.json` — compiled function addresses and sizes.
- `manifest.json` and `SHA256SUMS` — compiler, source, image and recipe identity.
- `emitted-code-verification.json` — independent Capstone branch/trampoline audit.

Bundle SHA-256:
`83fc2ea805ba67b324f02c260904f518d997edae6051724b366fa477ec7b7616`

Main payload SHA-256:
`a795d3f847a6b3e17ff5a40059c572bcb0ccf600b1e1a6a36728c4bde4d3adfa`

The bundle is 4,533,997 bytes. Its main payload is 3,754,816 bytes. All 15
package/runtime version strings identify as **2.2.10.12**. Codec, BLE, touch,
case, and bootloader payloads are byte-identical to stock **2.2.10.10**.
The local webflasher pin allows transfer of the **Apollo main only**.

## Address review

`scripts/cfw/g2-2.2.10.10-address-profile.json` now records 139 ROM, RAM,
hook, boundary and supporting-code mappings (28 added for this revision) and
23 named hook sites. New mappings were produced by
`scripts/cfw/map_g2flash_addresses.py` (unique normalized Thumb instruction
windows; RAM through matched PC-relative literal loads) and reviewed by
side-by-side disassembly before `scripts/cfw/extend_profile_g2flash_head.py`
recorded them with stock byte signatures.

| Purpose | 2.2.9.22 | 2.2.10.10 |
| --- | --- | --- |
| Set Local Feature LE 2M byte | `0x004c6b30` | `0x004c8c5c` |
| Fast connection-parameter table | `0x007ae7b8` | `0x007b2870` |
| `_connectParamReq_impl` mode byte | `0x0047ae50` | `0x0047c0ec` |
| Head-up idle gate call | `0x0045f006` | `0x0045f386` |
| Idle-input mode check call | `0x0045f01a` | `0x0045f39a` |
| Stock idle gate (trampoline literal) | `0x0046f136` | `0x0046f71a` |
| GAF decode call | `0x004b6922` | `0x004b8806` |
| Heading report call | `0x004b632e` | `0x004b8212` |
| IMU ring (unchanged) | `0x200652e0` | `0x200652e0` |
| Magnetic seen / accuracy / anomalies | `0x2007737e/80/7f` | `0x200773fe/0x20077400/0x200773ff` |
| R1 battery cache | `0x200772a6` | `0x20077314` |
| Ring connection bits | `0x20077406` | `0x20077489` |

Every new site is instruction-for-instruction identical apart from relocated
branch targets and literals. The build additionally pins the head-up message
slot (`[sp, #0xc]`, payload at +8), the idle-input record register (`r4`),
the 20-record 0x70-byte IMU ring layout with its bit-5 valid flag, the GAF
output offsets (+0x44..+0x46, +0x4d), the six upstream ring-battery ABI byte
signatures with their rebased literal words, and the two literal references to
the fast connection-parameter table.

The capability marker is now short enough that clang materializes it as
immediate byte stores inside `settings_send_wrapper` instead of `.rodata`.
The build therefore verifies the marker by reconstructing those stores with
Capstone (`capability_marker_emitted`) rather than by byte search.

The feature blob (40,932 bytes) begins at `0x007c2b3c`; the installed image
ends at `0x007ccb20`, leaving 144,608 bytes below the `0x007f0000` ceiling.

## Manual test

1. Begin with both temples on stock **2.2.10.10** (or the previous 2.2.10.x
   candidate; only the Apollo main is rewritten).
2. Open the local webflasher at `http://127.0.0.1:3000/#firmware`
   (`npm run dev -- --host 127.0.0.1`).
3. In **Advanced Mode → Firmware**, choose `g2-2.2.10.12.bin`. Confirm the
   recognized target is **SybilSight CFW 2.2.10.12 (manual-test candidate)**.
4. Use the Bluetooth update controls to select and explicitly confirm Left and
   Right. Retain the console log.
5. Check that both temples report **2.2.10.12** and that the settings READ
   response carries `Faceclaw/3`.

## Reproduce and verify

```sh
python3 scripts/build_g2flash_cfw_2_2_10.py --verify-only
npm run build:cfw-2.2.10
python3 scripts/cfw/verify_emitted_2_2_10.py
python3 -m unittest -v scripts.test_g2flash_cfw_2_2_10
npm run check
```

The recorded compiler is Apple clang 21.0.0. The recipe replays the recorded
candidate without a compiler:

```sh
python3 ~/Repo/g2flash/patches/apply_patches.py \
  public/firmware-updates/source-files/2.2.10.10/5d2abaf086ad7cc4709cad679b7b24d1.bin \
  work/cfw-2.2.10/candidate/cfw_patches-2.2.10.12.json \
  work/cfw-2.2.10/replayed.bin
```

## Bluetooth update path fixes found during the hardware runs

Run 1 (simultaneous left + right) flashed the right temple completely (917/917
blocks, END verified, reboot) while the left timed out eight times on "no G2
authentication response arrived on the control channel"; run 3, with the left
given the head start, flashed the left completely while the right timed out the
same way. So whichever temple starts its session while the other temple is
receiving OTA data never answers the control-channel authentication, and by the
time the solo retry ran (ten minutes after selection) Chrome had expired the
idle handle ("Bluetooth Device is no longer in range") with no way to reselect.
Changes in `src/lib/g2BleOta.js` / `src/App.jsx`:

- **Held links, sequential transfer.** `flashG2BleSessionsSequentially` holds and
  authenticates both links first (right, then left — while nothing streams), then
  transfers right and then left, reusing the already authenticated link
  (`holdLink`, `linkAuthenticated`) instead of authenticating again. The second
  transfer starts the moment the first settles, so its handle is still fresh; if
  its link dropped during the first transfer the bounded reconnect runs against a
  temple that was connected seconds earlier. The app no longer uses the
  simultaneous runner for a pair.
- **Authority-relayed replies.** Sessions of one run share a
  `G2BleAuthenticationRelay`: an authentication reply that arrives on the other
  temple's link is attributed by its magic token (each side draws magics from a
  distinct range, `G2_BLE_AUTH_MAGIC_SEEDS`), matching how the app's SDK treats
  responses the pair egresses through the right (authority) arm.
- **Dead saved handles.** When every bounded connect ends in a connection-loss
  class error, `g2BleSelectedHandleUnreachable` skips the pointless solo retry,
  clears that side so the chooser can be reopened, and the failure summary says
  to wake and reselect the temple; the completed side's result is retained.

Eight tests cover the sequential runner (order, held links, failure isolation),
link reuse without re-authentication, the relay and magic ranges, the race where
a relayed reply lands before the waiter exists, and the unreachable-handle
classifier.

### Run 4: sequential held-link runner on hardware

Both links authenticated before any transfer (right 6 s, left 15 s after
Update), the right temple transferred in 4 min 8 s and the left in 4 min 12 s,
each 917/917 block ACKs and END 8 (UPDATING) verified, with the second transfer
reusing its held link ("reusing the held, already authenticated Bluetooth
link") and no authentication timeout anywhere. That closes the failure the
first three runs kept hitting.

What the run also showed is the one fault every run shared, on both sides:
after the verified END and the 10 s reboot pause, all 24 post-END reconnect
attempts (125 s per side) failed with Chrome's "Bluetooth Device is no longer in
range." while the temple was already advertising again. Chrome answers that for
a remembered handle until a *scan* observes a fresh advertisement, and a page
without `watchAdvertisements()` (stock Chrome, Electron) cannot start one, so
the loop could never succeed and the flasher ended in "awaiting Case proof" —
useless on this Case, whose right pogo contact is faulted. A fresh chooser pick
is the one scan a page can always trigger: re-selecting the right temple reached
it in 4.4 s on the same device ID and its Device Information reported firmware
`2.2.10.10` (a reviewed CFW temple reports its stock base there), hardware
`2.2.10.10`, model `S200`.

Changes for that:

- **Stale-handle early exit.** `settleFinalUpdate` counts consecutive
  stale-cache refusals (`isG2BleStaleHandleError`) and, when advertisements
  cannot be watched, stops after `G2_BLE_POST_UPDATE_STALE_HANDLE_ATTEMPTS` (4,
  about 25 s instead of 125 s), returning `staleHandle: true` and
  `reselectionRequired: true`. Where `watchAdvertisements()` exists the
  interval doubles as an advertisement wait (`waitForG2Advertisement`) so the
  reconnect fires the moment the rebooted temple is heard.
- **Re-selection proof.** `proveG2BleTempleByReselection` opens the chooser
  for the side, connects, reads the Firmware/Hardware Revision and Model strings
  from Device Information (now in the chooser's `optionalServices`), and
  compares the revision with every string the release may report (stock base
  and package identity). `applyG2BleReselectionProof` folds the proof into the
  recorded routes so `g2BleRoutesAwaitingCaseVerification` clears the side. The
  Bluetooth card shows a "Re-select LEFT/RIGHT temple to prove its update"
  button per awaiting side; when the last side is proven the update is marked
  complete and the evidence transcript is emitted with phase
  `bluetooth-smart-glasses-recovery-reselection-verified`. A revision that
  matches neither expected string is an error, and no firmware is ever
  replayed.

Four more tests cover the early exit, the unchanged budget for non-stale
failures, the advertisement-driven reconnect, and the proof (chooser, Device
Information read, route update, mismatch, wrong side).

### Runs 5–7: the rebuilt bundle end to end

- **Run 5.** The left link's hold failed eight times with Chrome's opaque
  "Unsupported device." (the left had rebooted after run 4 and nothing had
  connected to it since); the right transferred and its post-END loop now
  stopped after 25 s instead of 125 s. Two fixes: the sequential runner settles
  a failed hold immediately, before the other side's transfer, so the operator
  is told while there is time to wake the temple; and a side proven over
  Bluetooth is retained by a repeat Update (`provenBleRoutesRef`,
  `g2BleRouteProvenOverBluetooth`), so re-selecting the failed side and
  pressing Update transfers only that side. The SybilSight app then connected
  and authenticated both arms, so the temple itself was healthy; a fresh
  chooser pick in run 6 held it without incident.
- **Run 6.** Both holds, both transfers, both 25 s stale exits. The left proof
  reached the rebooted temple in 5 s but was rejected: Device Information
  reports the stock base `2.2.10.10` and the expected list held only the
  package version. `baseVersion` now lives on the pinned target (generator,
  table and sync test), and `g2BleExpectedFirmwareRevisions` builds the list
  the proof accepts.
- **Run 7 (complete).** Holds 4 s / 15 s, right transfer 4 min 8 s, left 4 min
  12 s, 917/917 ACKs and END 8 each, stale exits 25 s each, then "Re-select
  LEFT" proved the left in 4 s and "Re-select RIGHT" the right in 2 s, both
  reporting firmware `2.2.10.10` on hardware `2.2.10.10`, model `S200`. The
  card ended on "Bluetooth update complete · both temples proven by fresh
  re-selection at reported G2 2.2.10.12" with no error banner and no Case
  involved. Total 10 min 5 s from Update to complete.

Harness notes for anyone repeating this: the page must be in Easy Mode (the
`#firmware` hash opens Advanced Mode, where the Bluetooth card is hidden and a
scripted click on it opens no chooser), and the first `requestDevice` after a
reload can resolve NotFoundError before any chooser round — a second click
works.

## Hardware status

**Flashed on 2026-09-13** to `Even G2_32_R_8D6E3C` (run 1, simultaneous session)
and `Even G2_32_L_ACD458` (run 3, after the fixes above), each with 917/917
blocks accepted, END verified and a clean reboot, through the local static
webflasher build (`npm run hardware`) hosted in an Electron shell that answers
the Web Bluetooth chooser programmatically. The previous firmware reported
2.2.9.22 (upstream's `EVENCFW/18 … als16` build); afterwards both temples report
**2.2.10.12** and the SybilSight Catalyst app resolves **bilateral CFW detected
— Faceclaw/3**, authenticates both arms, and reports wear state, with the R1
relay bound.

Application-level Bluetooth profile (same synthetic peek workload, 60 s, right
temple display lane): 5.70 kbps in 199 packets before, 2.37 kbps in 98 packets
after, 1 ms burst spacing in both. This is the app choosing lighter rendering
paths now that the reviewed contract is recognised exactly; negotiated PHY and
connection interval are not measured by this tool.

Four-microphone array: the capture path is compiled in behind MIC_FLAG_ARM_HW
(g2flash HEAD `mic_control.c`, entry points rebased with 11 unique matches each).
Arming it on this pair (2026-09-13) was acknowledged (field 104 active/hwArmed,
raw PCM 16 kHz) but produced no stream frames, and each temple dropped its link
within a minute and rebooted (left 21 s, right 62 s after arming). The rebased
addresses match, so the fault is in upstream's ABI-inferred seams, not the port;
`hardwareValidation` for the microphone path stays failed. Configuration
without the arm flag is harmless. The sequential held-link runner was
validated on hardware in run 4 (both temples, no authentication timeout); run 7
completed the rebuilt bundle end to end, transfers plus both re-selection
proofs, with no Case involved (see "Runs 5–7" above).

## 2.2.10.13: the microphone capture seams, recovered

Arming the array on 2.2.10.12 (above) produced no frames and rebooted the temples.
Disassembling the 2.2.10 stock image at the rebased entry points explained both:

| seam | upstream `mic_control.c` assumed | 2.2.10 stock actually is |
| --- | --- | --- |
| `SVC_PcmAppRegister` 0x00595F74 | `(slot, app_id, cb)` | `(owner, slot, cb)`: r1 is the slot (must be < 2, stored at entry+4 and compared by the dispatcher), r0 the owner stored at entry+0, r2 the callback at entry+8; re-registering an occupied slot clears and overwrites it |
| `SVC_PcmAppUnregister` 0x005960CC | `(slot, app_id)` | `(owner, slot)`, owner compared with entry+0 |
| `service_algo_process` 0x005ADF18 | `(pcm, &ssr, &angle)` | `(pcm, length, &ssr, &angle)`; the dispatcher's own fallback passes its (pcm, length) pair |
| PCM tap callback | `(source, pcm, bytes)` | confirmed: `SVC_PcmAppProcessData` 0x005961F4 validates slot < 2, pcm ≠ 0, length ≠ 0, checks entry+4 == slot, then `blx entry+8` with (slot, pcm, length) |
| `production_codec_mic_func_init(sel)` 0x005AB8CA | "selects single or stereo callback" | sel 0 registers the stock mono callback 0x005AB811, sel 1 the stereo one 0x005AB715, both as `SVC_PcmAppRegister(0x10B, 0, cb)`, then starts the codec (0x005565E0) |
| `Thread_MsgStreamingNotifyByBle` 0x0047ED08 | `(buf, len)` | confirmed (len is `uxth`'d) |

With the upstream order, 0x4643 landed in the slot check, registration returned -1, and
the stock callback stayed in slot 0, so nothing was ever streamed. Meanwhile the app's
stock voice pipeline kept re-initialising the codec (a silence-watchdog restart fired 7 s
before the left temple's link dropped), and the three-argument algo call would have written
an angle through an uninitialised r3 once a tap did run.

`scripts/cfw/overlays/2.2.10.13/mic_control.c` is g2flash HEAD's file with the two
signatures corrected, the tap registered as `SVC_PcmAppRegister(0x10B, 0, &mic_pcm_tap)`
after the front-end init (so the stock deinit's `SVC_PcmAppUnregister(0x10B, 0)` still
matches), and the algo call passing the dispatcher's length. The build script gained
`--source-overlay DIR` (only pinned names may be replaced; every replacement digest lands
in the manifest as `sourceOverlaySha256`) and `--candidate-version`. Output:

- `work/cfw-2.2.10/candidate-2.2.10.13/g2-2.2.10.13.bin`
  SHA-256 `1ad820c2b1e58827e55a4cad86b818cad4539b01bd379900261d6c5585b25b34`
  (4,533,981 bytes); main `8f33c0092a696499098f68ce314c6b96da8741cc99ba95489d345681a56a0c3e`
  (3,754,800 bytes); overlay `mic_control.c`
  `d629389ee088250b54d0339f3f2cd1445898f1328ce5d380fc7513f8dfbf407b`.
- `verify_emitted_2_2_10.py` passes; the emitted `mic_session_start` was read back with
  Capstone: `movw r0,#0x10b; movs r1,#0; r2 = pc-relative &mic_pcm_tap; blx 0x595f75`, and
  `mic_pcm_tap` calls 0x5adf19 with `mov r3, sp` for the fourth argument.
- Pinned as `REVIEWED_CFW_2_2_10_13` (local-only, `hardwareValidated: false`) in the
  generator, the target table, the sync test and the local candidate test.

The app side (SybilSight SDK) now turns the stock mic off and suspends the silence
watchdog while the array is armed (`glasses.cfwMicArrayArmed`), and restores it on STOP.

## 2.2.10.14: the array stream has to be compressed on the temple

Armed on 2.2.10.13 (16:30), both temples stayed up, the tap registered and the
field-104 counter reached 49 frames, but no `SM` frame ever reached the phone: a raw
PCM16 stereo tap buffer is 21 + 800 bytes, several times a BLE notification, and raw
stereo at 16 kHz is 64 kB/s. Upstream's `mic_control.c` streams raw PCM "until the
on-device LC3 seam is validated", so on this contract nothing can arrive. The
2.2.10.14 overlay (`scripts/cfw/overlays/2.2.10.14/mic_control.c`, +502 bytes of
blob) has the tap decimate 2:1 to 8 kHz and pack packet-independent IMA ADPCM, the
wire format the app already decodes for contract 29: payload `[pred0 s16, idx0 u8,
pred1 s16, idx1 u8]` then one nibble pair per output sample (low nibble channel 0),
at most 200 samples per channel per frame (206-byte payload, 227-byte notification).
Frame byte 14 says codec 2, the rate field says 80 (×100 Hz). The per-frame tick
lease check is dropped in favour of the RTOS watchdog timer because the rebased tick
cell's unit on 2.2.10 is unmeasured; the frame header still carries the tick so the
phone can measure it.

- `g2-2.2.10.14.bin` SHA-256 `56be9c28cad2664ce0196822921d9a48135ddeed5731ffbf2aa4d19b10e60b48`
  (4,534,483 bytes); main `704add9ac9ea40f1c070342aca027ff07311b1d23c3419e0d2d6a77ea7a2a6a2`
  (3,755,302 bytes). Verifier passes; pinned as `REVIEWED_CFW_2_2_10_14` (local-only).
- App side: while the array is armed the SDK turns the stock mic off and suspends the
  silence watchdog (`glasses.cfwMicArrayArmed`), because every stock mic enable
  re-initialises the codec and re-registers the stock PCM callback over the tap.

**Hardware result, 2.2.10.14 (2026-09-13, 16:59):** both temples flashed and proven
(5 s / 10 s re-selection), armed together, and the array streamed continuously from
both sides with no link drop: about 100 frames per second across the pair, each
2 × 201 samples at 8 kHz, decoded by the app (`SonicRadar: frame #9000 from L …`).
The firmware's own angle field is a constant -8° on this contract (its estimator
expects interleaved stereo), so the phone estimates direction itself from the two
temples' front microphones (`SonicBearingEstimator`, normalised cross-correlation,
145 mm spacing).

## 2.2.10.15: undecimated 16 kHz ADPCM array stream (local candidate)

Built 2026-09-13 from the 2.2.10.14 overlay with one change in `mic_control.c`: the tap now
honours the CONFIGURE rate. A request of 160 (16 kHz, which the app already sends for the
`Faceclaw/3` contract) disables the 2:1 decimation, so every 16 kHz capture sample is IMA ADPCM
coded. The stereo dispatch (2 × 400 B = 200 samples per channel) therefore yields a 206-byte
payload + 21-byte header = 227 bytes per frame, one notification at the negotiated MTU 247
(244 usable). Requests below 160 keep the 8 kHz form (106-byte payload). Capture itself still
runs at the fixed stock 16 kHz; field-104 `effRate` now reports the payload rate the phone
will decode (80 or 160) rather than the capture rate. IMA ADPCM is 4 bits per sample, so the
per-temple stereo stream is 128 kbit/s at 16 kHz (64 kbit/s at 8 kHz).

Why not more: raw PCM16 stereo at 16 kHz is 512 kbit/s per temple and a single capture
buffer (821 B) already exceeds one notification, which is the 2.2.10.12 failure recorded above.
Raw mono at 16 kHz would need frame fragmentation and 256 kbit/s per temple, and would drop
the second channel the beamformer needs. 16 kHz ADPCM stereo is the highest form that keeps
both channels, one frame per notification, and packet-independent decoding.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.15.bin | 987d4e09b57e2d99c4d25da141e8a9934a1344ac840dbd11bbac1c8188b4618f | 3755046 B, 13073f782f706ae3e2439ccd141be4ad7b7e2270d4090b20b0c35a59f3547bfe |

Hardware results are recorded below once the candidate has been flashed and exercised.

**Flashed 2026-09-13 21:23–21:33** through the Electron flash shell (sequential held-link
runner: right then left, 917 blocks each, ≈4.5 min per temple). Both temples answered fresh
GATT connections after their reboot and were proven by chooser re-selection at reported
G2 2.2.10.15; no Case proof was needed. Array-mode results follow.

**2.2.10.15 hardware result (2026-09-13 21:55–22:05).** Both temples streamed, every emitted
frame reached the phone (no sequence gaps), the frames carried rate 16000 and 2 × 200
samples, and the firmware tick advanced a median 51 ms per frame on both sides. So the capture
dispatch hands the tap one ~50 ms chunk (800 samples per channel) per callback, and the single
frame per chunk carried 12.5 ms of it: 25 % audio coverage at 16 kHz, and by the same
arithmetic 2.2.10.14's 8 kHz form carried 50 % (200 decimated samples of 400). The link was
never the limit; the packer was.

Separately, the bilateral CFW negotiation did not resolve after the flash. Disassembly shows
why: the stock protobuf transmit path (`Thread_MsgPbTxByBle`, 0x47eaa5) drops every settings
reply on the LEFT temple ("left can't send pb"), so field 104 and the device-info read-back
are always produced by the right temple (sideId = 1). The side getter itself (0x45d35d,
RAM byte 0x20077466 from GPIO156; 1 = right, 2 = left) is correct. Benches use the DEBUG
capability override until the app attributes by link.

## 2.2.10.16: sliced frames (local candidate)

Built 2026-09-13 22:10 from the 2.2.10.15 overlay. The tap now slices each capture chunk into
as many 200-sample frames as it needs (two at 8 kHz stereo, four at 16 kHz stereo). Frame
flags: bits 4–5 slice index, bit 3 more slices follow, bit 6 produced by the left temple,
bit 7 truncated (only beyond four slices). All slices of one chunk share the tick; the phone
pairs left/right slices by index. Expected cost: 40 or 80 notifications per second per temple
(9 or 18 kB/s); whether the notify path sustains the 16 kHz form is the next measurement.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.16.bin | a3e51afd44dedd124b46b214eee6c35c4d12dc644d474cab6e05dc3e9d8bf470 | 3755250 B, 166b0409a498a82e4dd5d776447b05cdc430533d89e88ead576dee0fd7480a97 |

**2.2.10.16 hardware result, first run (2026-09-13 22:27–22:40).** Flashed both temples (the
right temple's post-reboot reconnect failed once and was proven by a fresh re-selection). Right
temple: firmware tick still 51 ms per capture chunk, now four 200-sample slices per chunk,
4901 frames in 62 s ≈ 79 frames/s ≈ 0.99 s of audio per second at 16 kHz stereo — full
coverage, and the link sustained ~18 kB/s per temple with no sequence gaps. Left temple: zero
frames the whole run. Cause found in the app, not the firmware: the SonicRadar stale-session
guard fired on the app's own arming ("glasses report an active microphone-array session this
instance did not start; sending STOP"), the STOP landed mid-arm, and the left capture stayed
wedged through the re-arm and the ×3 re-CONFIGURE loop (the same wedge a quick-restart cleared
earlier in the day). Fixed: the guard now ignores sessions this instance has requested or is
auto-enabling; the next run reboots the left temple first.

**Pairing time, corrected (2026-09-14 03:20).** The "five-minute pairing" seen in every bench
since 21:12 was a bench artifact: the wait loop tailed the SDK log from a byte offset captured
before the relaunch, and the app rotates that file on launch, so the match never came and the
loop printed at its 300 s timeout. A pid-filtered relaunch measured 31 s from launch to "Both
sides authenticated", with both arms connected and notifications ready within three seconds of
the first connect; the packet log shows both links exchanging traffic within two seconds of
every launch. One genuine slow case remains unexplained: the 21:34 launch right after the
2.2.10.15 flash took 4.5 min to its first reconnect attempt, coinciding with the right temple's
random-address change after reboot (the flash shell also failed 8 cached-handle reconnects to it).

**Arm/stop cycle baseline, 2.2.10.16 (2026-09-14 03:35).** New DEBUG probe
(`debug.arrayCycles`): after a left-temple soft reboot and with the stale-session guard fixed,
eight arm(30 s)/stop(10 s) cycles streamed both temples symmetrically every time (≈2 340
frames per temple per window ≈ 78 frames/s, full 16 kHz stereo coverage), no link drops during
cycling. First frame arrived 11 ms after the initial auto-enable and ≈5.0–6.5 s after each
re-arm; that latency is the app's fixed settles (1.5 s after STOP, 2 s after the stock-mic
disable, 1.5 s between the left and right CONFIGURE), not the firmware. The left temple still
reports no status on this firmware (pb gate); 2.2.10.17 adds the audio-path status mirror.
Rebooting the left temple also drops and re-establishes the right link ("Disconnected RIGHT"
→ "Reconnection successful" → "pair rebooted while the microphone array was armed; re-arming").

## 2.2.10.17: left-temple status mirror (local candidate)

Built 2026-09-14 03:28 from the 2.2.10.16 overlay. `mic_send_status_notify` on the LEFT temple
also emits the bare 21-byte field-104 body on the streaming-notify characteristic, which the
stock protobuf gate cannot block; the phone's audio-notify dispatch already routes an
`'M','C',1` record to the microphone-array status handler, attributed to the link.
| g2-2.2.10.17.bin | 6be18b390d1a807e34e8d7e531abf8fb04914831ebe594435d16d0515e87fd9f | 3755426 B, bbb60e2d6ddd4f32f47b397de997812e3bfecdd6056c217c91ed2bd5866fd3d4 |

## Root cause of the left/right microphone instability (2026-09-14 03:30–04:00)

Disassembly of stock 2.2.10.10 (`thread.audio` 0x555f72…, `service_audio_manager` 0x56ac64…,
codec driver `drv_gx8002b`) against the overlay's arming path:

1. **Stock capture is left-temple only, owned by an audio manager the overlay bypasses.**
   `service_audio_manager` acquire/release (0x56ac64/0x56adf2) are no-ops on the right temple;
   on the left they turn the codec and PDM on for the first stock app (EvenAI, translate,
   conversate, teleprompt, terminal, AT+AUDIO) and power the codec down when the last one
   releases. The stock mono LC3 stream is the slot-0 fallback in `SVC_PcmAppProcessData`
   (0x5961f4) on the left temple's link. The overlay's `production_codec_mic_func_init`
   (0x5ab8ca) registers the tap and posts codec-on without consulting that app table, so any
   stock release on the left issues `codec ctrl(0)` (I2S deinit + output off) under the tap:
   permanent silence until the phone re-arms. The right temple runs a path stock never uses.
2. **The codec driver's one-shot audio check reboots the codec under the stream.** The I2S DMA
   handler (0x55626a) counts a 50 ms frame only if the audio thread dequeues it within 41 ms
   (else "codec i2s dma int timeout", frame dropped). Two seconds after every codec-on, the
   check (0x5564d2) requires ≥ 20 fresh frames or logs "codec audio check fail! low count …
   restart codec" and performs a 1.75 s blocking GX8002 reboot, re-arming itself until a window
   passes. The tap's per-frame work (ADPCM, up to four notifies with their own malloc and
   queue put) and any codec UART transaction (voice-event polls, 3 × 200 ms) can make frames
   stale, so a fresh arm can fall into a reboot loop: this is the "49 frames then silence".
   The watchdog never touches the PCM app table, so the tap stays registered while the codec
   is rebooted; the reboot path skips I2S re-init.
3. **A right-temple (re)boot closes the left DMIC.** The boot-only inter-temple sync (service
   id 0x10c: right→left 1 "closing DMIC", left→right 2, right→left 3 "reopening DMIC") re-runs
   whenever the right reboots; the left's DMIC stays closed until the right's codec check
   completes. This is the only firmware mechanism where arming or rebooting the right affects
   the left, and it matches the "left first, then right" workaround.
4. **BLE is not the wedge.** `Thread_MsgStreamingNotifyByBle` → `_dispatchMsgTxByBle`
   (0x47e5de) drops when the ESS queue holds ≥ 75 entries and requests the fast connection
   profile when not in it; backpressure shows as dropped frames and parameter churn, never
   as a stalled audio thread.
5. **The left temple cannot answer over protobuf** (`Thread_MsgPbTxByBle` gate, "left can't
   send pb"), so every field-104 status and device-info reply the phone ever saw came from the
   right temple. The per-arm producer attribution therefore had no left evidence, and the
   bilateral contract never resolved without the override. The side getter itself is correct.
6. Two app-side faults compounded it: the stale-session guard sent STOP mid-arm (fixed), and
   the bench wait loop misreported pairing as 5 minutes (fixed; real pairing is 31 s).

Fixes: 2.2.10.16 slices frames (coverage), 2.2.10.17 mirrors the left status on the audio
path, 2.2.10.18 adds opt-in audio-manager arming (CONFIGURE flag bit2): PCM slot 0 taken first,
audio-manager app slot 7 held on the left, codec opened via thread.audio's own codec-control
primitive (0x5565e0), the audio-check flag (0x20077470) cleared from the tap once frames flow,
codec powered down on stop only when no stock app holds it, and the codec-driver state cells
appended to the mirrored status so the phone can tell a codec reboot from a stock release
from BLE loss. App: `sonicRadar.managerArming` selects bit2.
| g2-2.2.10.18.bin | a020741f22a74eb1fa91f2b3caa4e9a2b797a8ed48732f7cc1b735510001b96d | 3755878 B, 8a6ab7ba9a2a5ad5cd97b0bdec436c456f8139f5d01e18d3351295705cb7bd6b |

**2.2.10.17 hardware result (2026-09-14 03:46–03:53).** Flashed and proven. The left temple's
status now reaches the phone over the audio path ("field-104 status L: active=true
hwArmed=true …", and `frames=2348` at STOP), the first left-produced record ever observed.
Eight arm/stop cycles without a temple reboot: cycles 3–8 full on both temples (2 343–2 349
frames per 30 s); cycle 1 partial on both (a mode-11 cleanup re-arm landed inside the window);
cycle 2 left 1 958 vs right 2 348, i.e. ≈5 s of left audio lost right after re-arm — the
codec audio-check failure + 1.75 s GX8002 reboot signature predicted by the disassembly.

**2.2.10.18 hardware result (2026-09-14 03:52–04:17).** Flashed and proven. Two six-cycle
arm/stop tests, no temple reboot in between:

| mode | cycles full on both temples | min frames L / R per 30 s | re-arm first frame |
|------|-----------------------------|---------------------------|--------------------|
| A: production arming (flag bit2 off) | 6/6 | 2 344 / 2 345 (cycle 1 partial: auto-enable mid-window) | 5.0–5.6 s |
| B: audio-manager arming (flag bit2 on) | 6/6 | 2 346 / 2 344 (cycle 1 partial, same) | 5.0–5.6 s |

Mirrored left status with the codec-driver cells, mode B: while armed `codecOn=0 pwr=1
slots=0x80 by=2` (audio-check flag cleared by the tap, codec powered, app slot 7 held, record
produced by the left); after each STOP `slots=0x20 codecOn=1 i2s=1 dma=151…182` (a stock app —
the captions microphone — takes the left codec back and the driver's own DMA count runs);
at the next arm `slots=0x0 codecOn=0` (the app's stock-mic disable released it first). The
right shows `sync=1`, the left `sync=0`, as the boot handshake predicts. The re-arm latency is
the app's fixed settles; with real per-temple status now available it can become state waits.
`sonicRadar.managerArming` stays off by default until a longer soak; both modes are stable here.

**App arming latency (2026-09-14 04:40).** `setCFWMicrophoneArrayEnabled` now caches the last
field-104 status per temple (settings reply or audio-path mirror, producing side from byte 30)
and waits on state instead of fixed settles: both temples inactive after STOP (≤ 1.5 s), the left
temple's audio-manager slots empty and codec-on clear after the stock-mic disable (QUERY every
250 ms, ≤ 2 s), and the left armed before the right CONFIGURE (≤ 1.5 s). Older firmware keeps
the previous fixed waits as fallbacks. Logged as "microphone array pre-arm settle:
stopped=… stockReleased=… in N ms".

## Radio: why the link ran on the phone's default profile (2026-09-14 10:30)

The user observed a 2 Mbps-capable radio (EM9305 controller behind a Packetcraft/Cordio host)
negotiating 1M and running well below it. Disassembly of the connection-parameter path in
2.2.10.10 explains it: `_connectParamReq_impl` (0x47c0e8) selects one of two fixed profiles
(fast at 0x7b2870: stock 15/30 ms, latency 0, timeout 6 s; slow at 0x7b2860: 45/90 ms,
latency 4) and issues `DmConnUpdate` (0x4cd57c). Upstream g2flash patches the fast profile to
**7.5/7.5 ms** and forces every request to the fast profile. Apple centrals reject intervals
below 11.25 ms, the firmware has **no fallback profile** (it re-requests the same values every
30 s via the ESS fast-mode path, 0x47d478), and a rejected update leaves whatever the central
last granted in force. So on the Mac the link never left CoreBluetooth's default interval. The
"LE 2M" patch only sets local-feature bit 8 (vendor opcode 0xfff2 block at 0x4c8c5c); the
temple never requests a PHY change on the phone link (it does so only for the ring, via
`DmSetPhy` 0x4ddb04 → HCI 0x2032), and the central decides. A temple-side 2M request must be
posted to the BLE task (the DM/HCI layer is not reentrant), so it is deferred to a later
candidate; measure first.

## 2.2.10.19: Apple-acceptable fast profile + link-parameter reporting (local candidate)

Built 2026-09-14 10:35 from the 2.2.10.18 overlay plus a reviewed `patch_compress.py` overlay:
fast profile **min 11.25 ms / max 15 ms** (bytes `09 00 0c 00` at 0x7b2870; latency 0 and the
6 s timeout unchanged; the slow-mode suppression and 2M feature bit unchanged). Both temples
also emit an `'M','L'` record on the audio path with the granted interval (1.25 ms units),
latency, supervision timeout (10 ms units), profile mode (0xa3 fast / 0xa4 slow) and the
connected flag, read from the slave connection context (*0x200765b8 + 0x18…0x1e, 0x200773a5).
The SDK logs it as "G2: link parameters L/R: interval=… ms latency=… timeout=… profile=…".

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.19.bin | 1171f03fd1799573e79ac7da0a72d08cf6caf69ec65dea421e432de6c156dcfc | 3755998 B, 9a6f96ddf8a3317993f390ca0608ba24b1dcf65a56cd49e5fbd6c9af7052ae5c |

**Arming latency with status waits (2026-09-14 10:37, 2.2.10.18, manager mode):** pre-arm
settle 2 953 ms on the first arm after launch, then **319 ms** per re-arm (was ≈3.5 s of fixed
sleeps), with both temples reporting inactive after STOP and the left reporting its codec
released before CONFIGURE.

**Recovery and transition test, 2.2.10.18 (2026-09-14 10:42–10:50).** The left temple had
gone silent after cycle test B (no frames, no mirrored status, stock captions silent). A soft
reboot restored it: production arming 3/3 full on both temples with the new status-wait
settles (first frame ≈1.2 s after re-arm), then manager arming 3/3 full after a kill-while-armed
in production mode. The reverse transition failed: the production-mode arm after the
manager-mode session streamed ≈2 s and then the left temple reset (both links dropped, "pair
rebooted while the microphone array was armed" ×2), recovering by cycle 3. The manager path's
one unverifiable write was the audio-manager app-table slot 7 hold; 2.2.10.20 removes it.
App: STOP is now sent on termination and SIGTERM so a killed instance never leaves the array
armed for the firmware lease to time out.

## 2.2.10.20: manager arming without the slot hold (local candidate)

Built 2026-09-14 10:52 from 2.2.10.19: manager-mode arming no longer writes the audio-manager
app table; on lease RENEW while armed in manager mode, if the I2S init flag is clear (a stock
release powered the codec down) the codec is re-opened. Everything else as 2.2.10.19.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.20.bin | 7bb87ac9d1182f5ffeb15382db4b6ce701711f1c1858a5ebd527887be29802db | 3755958 B, 9d70240009d4165f8ebf946aec779faf460ab90ba61e87916b6b2149895dddc0 |

**Link parameters measured (2.2.10.20, 2026-09-14 11:09).** Both temples report the phone link
at **interval 30.00 ms, latency 0, supervision timeout 720 ms, profile mode unset**: macOS's
default connection, unchanged by the fast-mode requests. So the 11.25–15 ms profile was rejected
as well. Apple's accessory parameter rules explain both rejections: interval min ≥ 15 ms and a
multiple of 15 ms, interval max ≥ min + 15 ms, latency ≤ 30, timeout ≤ 6 s. Stock's fast
profile (15/30 ms) satisfies them; upstream's 7.5 ms and our 11.25–15 ms do not.

## 2.2.10.21: stock 15/30 ms fast profile (local candidate)

Built 2026-09-14 11:12 from 2.2.10.20 with the upstream fast-interval edit reduced to a no-op
(stock `0c 00 18 00` kept). Everything else as 2.2.10.20. If the Mac now grants 15 ms the
'ML' record will show it; if it still shows 30 ms, the fast-mode request itself is not
reaching the central (next step: trace `APP_ConnectParamESSSetFastMode` on hardware).

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.21.bin | 0622ac8249b37ae28d2a3f301b604f7eba3d241ff3fad68d84987feaab7f3a55 | 3755958 B, e10dd49b74cac88d37023d0432acccd9e79b0ad16706cf4717396f5ad4ad6a5f |

**Stock microphone after array sessions (2026-09-14 11:20).** Every stock-mic captions run since
the array sessions began (v2d, v2e) produced no transcripts although PCM reached the recognizer
at 16 kHz: the recognizer's skip counters show every 0.65 s chunk at maxSignalPeak = 1.0 and
RMS ≈ 0.23, i.e. full-scale noise, so the VAD gate discards it. The same signature appeared on
array audio in the cycle-test instance. The left temple's microphone path delivers saturated
noise after an array session has run and stopped (either arming mode), and only a temple reboot
restores clean speech (captions worked at 21:12 right after the previous reboot). An isolation
run (reboot → probe → manager-mode cycles → probe → production-mode cycles → probe) is in
progress on 2.2.10.21 to attribute it, and the codec/DMA state left by our start/stop sequences
is being compared against the stock acquire/release path.

**Isolation run, 2.2.10.21 (2026-09-14 11:22–11:47).** Flashed and proven; both temples then
soft-rebooted. Stock-mic health probes (two spoken sentences, array off) after each stage:

| stage | probe | recognizer signal |
|-------|-------|-------------------|
| after reboot | transcribed (2 segments) | peak 0.15, RMS 0.004 in silence: clean |
| after 3 manager-mode cycles (3/3 full) | transcribed (3) | one saturated chunk at hand-back, then clean |
| after 3 production-mode cycles (cycle 1 lost the right temple to a reset, then 2/2 full) | transcribed (3) | 29 saturated chunks (≈19 s of full-scale noise) at hand-back, then clean |

So with the app now sending STOP on termination, the stock microphone recovers after both
arming modes; the earlier permanent saturation followed sessions that ended by a kill with no
STOP (the firmware's 90 s lease lapse path). A transient full-scale burst remains at hand-back,
brief after manager mode and ≈19 s after production mode, and the manager→production
transition can still reset a temple intermittently (once on 2.2.10.21, never on 2.2.10.20's
four transitions). Manager mode is the cleaner path on every measure.

**Link on 2.2.10.21:** still interval 30 ms, latency 0, timeout 720 ms, profile byte 0 — with
the stock 15–30 ms range the Mac's 30 ms default satisfies the request, so no update is ever
negotiated. 2.2.10.22 requests min = max = 15 ms, the exact form Apple's rules allow.
| g2-2.2.10.22.bin | 628b2a7f2a25b72dd0d21b26592e7ec552b1275148e4d1c2285f1234c3e85575 | 3755958 B, 24f71c9380b4b200baf6c2b496859e48ad7fd11f0bf2f29be746098662674317 |

## Codec-path analysis: what our arming did that stock never does (2026-09-14 11:50)

Disassembly of the stock mono path (`AUD_CodecDmaInt` 0x55626a → `SVC_PcmAppProcessData`
0x5961f4 → algo L/R average → `SVC_Lc3EncodeMono` → 205-byte notify) and of the codec-control
handler (0x556404) against the overlay found no shared RAM state that could turn clean audio into
full-scale noise; the divergences are sequencing:

- **D1** Both arming modes posted codec ctrl(1) unconditionally. On the left temple the codec is
  normally already on (the phone keeps the stock mic enabled), so the GX8002 received a second
  DMIC-open + I2S-output-on with the Apollo I2S init skipped ("gx8002b i2s already init").
  Stock never does this: acquire opens the codec only for the first app. Production mode
  additionally left the 2 s audio check armed under the tap's load, which can reboot the codec
  under a live I2S DMA. Most likely cause of the saturated stock audio after a session (~55 %).
- **D2** Stop unregistered slot 0 immediately while ctrl(0) was only posted, so one or two
  frames per temple went through the stock fallback and emitted stock-format LC3 packets, from
  the right temple too (which stock never streams); the phone's audio latch then fails over.
- **D3** Production stop called the production deinit (codec ctrl(0)) even when a stock app
  held the codec on the left.
- Production mode also created an empty `/audio/*.pcm` recording file per session.

## 2.2.10.23: stock-conformant codec arming (local candidate)

Built 2026-09-14 11:55 from 2.2.10.22: for the codec source both modes now take PCM slot 0
and open the codec only if its I2S is not already running (remembering whether we did); the
audio-check flag is cleared while frames flow in both modes; stop powers the codec down only if
we powered it up and no stock app holds it, and hands slot 0 back only after the audio thread has
processed the power-down (the silent tap unregisters itself on its next call; a 200 ms watchdog
covers the no-frames case so the stock fallback can never be left disabled). Internal state
lives in the high bits of the flags byte and never leaves the temple.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.23.bin | a16f0ca1159fbfcac9f5ce1d4818c46003671a01043a52c3bcb5c8b8df2773e3 | 3756022 B, 5c576a267af9a74237b8d1b3c5b10880755ca7126ed4d9d7502806ce679608fc |

**Link on 2.2.10.22 (2026-09-14 12:04):** still interval 30 ms, latency 0, timeout 720 ms,
profile byte 0, with min = max = 15 ms requested by the table. So the table contents were
never the problem: no request reaches the Mac at all.

## Radio root cause, corrected: the temple never asks (2026-09-14 12:20)

Disassembly of every path into `_connectParamReq_impl` (0x47c0e8) shows it is reached only
through BLE-task event 0xb9, posted by the request timer callback (0x47c710). That timer is
armed by three kinds of caller: (a) `APP_ConnectParamESSSetFastMode` (0x47d478), called by
the streaming dispatcher `_dispatchMsgTxByBle` (0x47e5de) only when its ESS queue is
backpressured (and then with a 30 s backoff); (b) the protobuf device-config handler
(0x4d3eba, `pConnParams->setSpeed = eConnParamState_FAST/SLOW`), which calls the setter
0x47d428 (fast, argument 0 = keep) or 0x47d598 (slow); (c) OTA and image-transfer paths that
call the same setter. The array stream delivers ~79 frames/s per link without ever filling
the queue, so path (a) never fires, and SybilSight never sent (b). Every candidate therefore
ran on CoreBluetooth's default 30 ms connection, whatever the fast table held. Two more
details from the same pass: the fast request has a two-link "fast budget" (0x47b61e, bit
mask 0x200773a4, cap 2; "fast capped, defer" retries every 2 s) and a 45 s rate limiter
(0x200773a7 / 0x200765c0); and 0x200773a5 is the *fast-mode-in-effect* flag, not "central
connected" (it read 0 while connected on the default profile) — the 'ML' record's byte 3
and the SDK log ("fast=") are relabelled accordingly.

## 2.2.10.24: temple-requested fast link (local candidate)

Built 2026-09-14 12:30 from 2.2.10.23 plus one seam: `FW_CONN_FAST` = the fast-profile
setter 0x47d428 (2.2.9.22 0x47c18c, rebased by the profile; ABI `(uint32 auto_slow)`
inferred from the protobuf handler's `movs r0,#0; bl` and the 60 s auto-slow timer behind a
nonzero argument). `mic_session_start` calls it with 0 when a session arms, and RENEW calls it
again while the granted profile byte is not 0xa3. It touches only flags and an app timer
(the DM call happens on the BLE task), so it is safe from the settings-write context. Stop
requests nothing: stock's slow profile (45/90 ms, latency 4) is slower than the Mac default.
The setter is also the phone-side alternative, and the SDK now carries it: the nanopb
descriptor for `DevCfgDataPackage` (0x7a334c; field 1 commandId, 2 magicRandom, a oneof at
struct offset 8 with carrier fields 3 authMgr, 4 roleChange, 5 ringInfo, 6 connParams,
7 disconnectInfo, 8 …, 13 heartbeat, 14 quickRestart, 128 timeSync, 129) gives command 7 →
carrier field 6 `ConnParams { 1: u16, 2: u16, 3: setSpeed (enum, nonzero = FAST), 4: bool,
5: u8 }`. `DevSettingsProto.connectionSpeed(fast:)` encodes `{1: 7, 2: magic, 6: {3: 1}}`
on service 0x80 with the app-request flag, `G2.requestPhoneLinkSpeed(fast:)` sends it to
both temples, and the array-arming path calls it before CONFIGURE (defaults key
`sonicRadar.requestFastLink`, default on) so stock and pre-.24 firmware get the fast link
too. Validation plan: link check A = 2.2.10.23 + app request (expects 15 ms from the
protobuf path alone), link check B = 2.2.10.24 with the app request off (expects 15 ms from
the firmware path alone), then the a24 array pass with both on.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.24.bin | 630ef16fea23116e8cf26a3b77be104bc6480ae0164641d26085997587acda20 | 3756090 B, 925b29cd0952bb44543516fbb613c059beb215587776d0bdda26601e46800bb3 |

Expected on hardware: 'ML' shows interval 15.00 ms / profile 0xa3 / fast=1 within a few
seconds of arming; per-link throughput headroom doubles (≈ 2× more connection events for
the same ≈ 18 kB/s stream). If it still reads 30 ms, the budget cap or the Mac is refusing
and the next trace is the update-event handler's "peer-initiated fast exceeds budget" path.

**2.2.10.23 isolation run (2026-09-14 12:20–12:30).** Flashed and proven (12:15), both temples
soft-rebooted, then the same three-stage probe as on 2.2.10.21:

| stage | probe | recognizer signal |
|-------|-------|-------------------|
| after reboot | transcribed (2) | clean (peak 0.01) |
| after 3 manager-mode cycles (3/3 full, first frame 0.85–1.4 s) | **no transcript, no audio reached the recognizer at all** | — |
| after 3 production-mode cycles (cycle 1 lost the pair to a temple reset at arm time, then 2/2 full) | transcribed (2) | one saturated chunk at hand-back, then clean |

The manager-mode silence is 2.2.10.23's own deferred hand-back. STOP powers the codec down and
leaves the silent tap in PCM slot 0 with a 200 ms watchdog fallback. The app re-enables the stock
microphone right after STOP; the stock production init re-registers slot 0 with the stock
callback under the same owner id (0x10B) before the watchdog fires; the watchdog's blind
`SVC_PcmAppUnregister(0x10B, 0)` then removes the *stock* callback and nothing produces LC3
until the next disable/enable. The production-mode run only won that race. The one-chunk
saturation at hand-back is unchanged from 2.2.10.21, so the redundant-ctrl(1) theory does not
explain it; the temple reset at the first production-mode arm is the third occurrence of the
intermittent reset and is still unattributed. Link parameters: 30 ms (26.25 ms on the link the
Mac re-opened after the reset), fast=0, as expected before 2.2.10.24.

## 2.2.10.25: no timer-path slot unregister (local candidate)

Built 2026-09-14 12:50 from 2.2.10.24 with the watchdog's hand-back unregister removed: the
tap unregisters itself on its next call (being called proves it still owns the slot); with the
codec off nothing dispatches to it, and both a stock enable and our next CONFIGURE overwrite
slot 0 (SVC_PcmAppRegister overwrites an occupied slot), so a lingering registration is
harmless. `MIC_UNREG_GRACE_MS` and the 200 ms timer start are gone; everything else as
2.2.10.24 (temple-requested fast link).

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.24.bin | 630ef16fea23116e8cf26a3b77be104bc6480ae0164641d26085997587acda20 | 3756090 B, 925b29cd0952bb44543516fbb613c059beb215587776d0bdda26601e46800bb3 |
| g2-2.2.10.25.bin | e924f0f253e8459365287fc1585aa3a731459c0d8c0e2a952bf2a7747c912d22 | 3756186 B, 90a750ed7c001583f13396d3bd464fb57803447297093cc416fc202e116a4bca |

2.2.10.24 is superseded before flashing. Validation chain queued: link check A on 2.2.10.23 with
the app's protobuf request, flash 2.2.10.25, reboot health, three manager cycles with the app
request off (firmware path only) and the stock-mic health probe after them, then the a25 array
pass and a final health probe.

**Link check A (2.2.10.23 + phone-side protobuf request, 2026-09-14 12:52).** The app sent
`ConnParams.setSpeed = FAST` to both temples before each of three CONFIGUREs (logged
"requesting fast connection profile via DevCfg ConnParams (cmd 7) on L+R"); the 'ML' record
still read 30 ms / profile 0 / fast=0 for the following 45 s. So either the request is being
deferred or capped on the temple (45 s rate limiter, two-link fast budget) or the Mac refuses
the min = max = 15 ms shape. The record cannot distinguish these yet.

**a23 array pass (12:30–12:52): the array audio itself was full-scale noise.** Every
recognizer chunk of the session hit peak 1.0 (VAD skipped all of them; the only transcripts
were "Uh"), so the transcription, six-voice and translation results are void and the beam
stimulus hung in the audio player (killed). Frames flowed at 16 kHz stereo with 0 loss on both
links, so the transport is fine and the codec output is garbage. Reading of the arming race:
the app's pre-arm settle waits for `appSlots == 0 && !codecOn`, but the slot table is cleared
synchronously by the stock release and the codec-on flag is cleared early (our own tap clears
it), while the I2S deinit and power-down run later on the audio thread. A CONFIGURE landing in
that gap sees `I2S initialised` still set, 2.2.10.23+ then skips the codec restart, the stock
ctrl(0) tears the codec down under the running DMA, and the DMA streams the torn-down codec's
full-scale noise for the whole session (2.2.10.18–.22 posted ctrl(1) unconditionally, but its
I2S init is skipped while the flag is still set, so the same race produced the same noise).
App fix (build 66435fcd…): the settle now also requires `i2sInit == false && codecPower ==
false` and logs the four codec cells; the radar frame log prints per-channel peak/RMS every
100 frames so a saturated temple is visible at once.

## 2.2.10.26: stock 15–30 ms fast table + request-path diagnostics (local candidate)

Built 2026-09-14 12:56 from 2.2.10.25: the fast table returns to the stock 15/30 ms values
(the one shape Apple's rules accept without doubt), and the 'ML' record grows to 20 bytes with
the request-path state: [12] last mode handed to `_connectParamReq_impl`, [13] accepted mode,
[14] rate-limiter deferred mode, [15] setter mode, [16] fast-budget link mask, [17] rate-limiter
pending flag, [18..19] request counter. The SDK log appends `req= acc= def= set= budget=
pending= count=`.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.26.bin | ee0d9016f4d6894e9561379b7e0a6b8a0ab6eb8f75c86263bbdb3cd0d7c29205 | 3756254 B, b8d0317859b3f45e4c70c6601c163f3d9104f85f85ed20b121d518fb303c0d56 |

## Root cause of the full-scale array noise: half-powered codec (2026-09-14 13:20)

The array audio was full-scale noise on every candidate from 2.2.10.18 on, whichever arming
mode. The 2.2.10.26 diagnostics pinned it. During an armed session the LEFT temple reports
`codecOn=1 i2s=0 pwr=1`: the codec chip is powered but the I2S is not initialised. That state
is left behind by a stock microphone release — `production_codec_mic_func_deinit` deregisters
the stock callback and tears the I2S down but does not power the GX8002 down, so the codec chip
stays on with no I2S. Disassembly of the codec-control on-path (0x556404 → codec_ctrl(1) →
0x5563dc → I2S init 0x595a58, guarded by the `0x200773d7` I2S-init flag): arming from that
half-powered state does not produce a clean init, and the I2S DMA then reads the GX8002's
free-running output — full-scale noise — for the whole session. Stock never hits it because
`production_codec_mic_func_init` always arms from a cold codec (a fresh boot or a full release).

2.2.10.18–.26 all armed straight into this state (they opened the codec only when the I2S flag
was already clear, which is exactly the bad case). The app's pre-arm settle could not avoid it
either: it waited for `appSlots == 0 && !codecOn`, both of which clear synchronously, while the
codec stays half-powered.

## 2.2.10.27: cold codec cycle before arming (local candidate)

The manager-mode arming path (and the RENEW re-power path) now, if the codec is powered at all
(`*CODEC_POWER_ON`), posts `codec_ctrl(0)` first — a full I2S deinit and power-down, a cheap
no-op on an already-off codec because both of its steps guard on their own state flag — then
`codec_ctrl(1)` for a clean cold init. Capture always starts from a cold codec, the way stock's
production init does. The app settle was relaxed to wait only for `i2sInit == false` (the codec
chip legitimately stays powered on the left, so power is not a ready signal) and 2.2.10.27's
firmware cold-cycles whatever remains.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.27.bin | 43cd3f48a0580001a38222eabdd3a546a0451d41cc05431010e980566fb3b4c4 | 3756270 B, d9cf331b0d23d76de572d1248887d4d949817be5d09869e3e57ad5f4bf35c37b |

Expected on hardware: armed-session `i2s=1` and per-channel peak/RMS in the speech range
(≈0.1–0.5 peak with the room quiet) instead of the constant peak 1.0; the caption probe and the
functional passes then run on real audio.

## Fast link: the request now goes out and is briefly accepted (2026-09-14 13:36)

With 2.2.10.27's request-path bytes in the 'ML' record, arming the array shows
`req=0xa3 acc=0xa3` and then `acc=0xa4`: the temple hands `_connectParamReq_impl` the fast
mode (0xa3), the update-event handler records fast accepted for a moment, then the link
settles back to slow (0xa4) and the steady interval stays 30 ms. So the request reaches the
central and is momentarily honoured, then the Mac pulls the interval back to its 30 ms default
(the connection-parameter request is answered but the negotiated interval is the Mac's choice;
`profile byte 0` because the temple's own fast/slow classifier reads the live 30 ms as neither
its <25-unit fast nor its >=72-unit slow threshold). The 15 ms class is simply not granted by
this Mac for this link. This is a central-policy limit, not a firmware defect: the request is
correct and delivered. Practical effect is small — the array stream fits comfortably in 30 ms
connection events (0% loss measured) — so no further firmware change is warranted for the
interval; the temple-side 2M PHY request remains the only untried lever and needs a BLE-task
post.

## The array capture never initialises I2S — both codec paths (2026-09-14 13:40)

2.2.10.27 tested both arming paths on hardware:

| path | armed status (LEFT) | per-channel level | stock-mic health after |
|------|--------------------|--------------------|------------------------|
| manager (codec_ctrl, cold-cycled) | codecOn=0 i2s=0 pwr=1 | peak 1.0, RMS ~0.25 (noise) | FAIL |
| production-init (FW_CODEC_MIC_INIT) | codecOn=1→0 i2s=0 pwr=1 | peak 1.0, RMS ~0.26 (noise) | (reboot restores) |

Both leave `i2s=0` for the whole armed session and stream full-scale noise (constant RMS ~0.26,
independent of whether anyone is speaking; real quiet-room speech on the stock LC3 mic measures
RMS ~0.005). The stock LC3 voice path on the same DMIC hardware is clean, and when it runs the
I2S-init flag is set. So the raw-PCM array tap is reading a DMA buffer that the I2S never filled:
the GX8002's floating output. The cold codec cycle (ctrl(0)→ctrl(1)) and the exact stock
production-init call both fail to bring `i2s` to 1 in the armed configuration — the I2S-init flag
(0x200773d7) stays 0. This is the remaining blocker for clean four-microphone audio, and it is a
capture-seam problem (I2S never initialised for the raw path), not transport (0% frame loss),
not the arming race, and not the hand-back.

Open options for the next session (a decision fork, needs direction):
1. Reproduce the exact I2S-init preconditions the stock LC3 path satisfies (compare the codec
   register/txn setup around 0x595a58 that the stock acquire runs but our path skips).
2. Capture through the stock LC3 mono path (which is known clean) and decode LC3 on the phone,
   giving up the raw four-mic planar stream for a proven-clean single channel per temple.
3. Accept the current transport and treat the array as a direction/energy sensor only (the SSR
   and per-pair TDOA still work), with captions/recognition on the stock LC3 mic.

## The design: 4-mic replaces the stock mic on a live codec (2026-09-14 14:15)

Per the wearer's directive, on a CFW build the four-microphone array replaces the stock 1-mic
interface entirely: only ever listen through the 4-mic endpoint, never toggle back to stock, and
feed that stream into the whole pipeline (recognition, transcription, captions, translation,
control). Two facts made the fix clear:

1. Every attempt to bring the codec DOWN and re-initialise it for the array (raw ctrl, cold
   cycle, production-init, codec-prep + ctrl — candidates .18 through .28) left the GX8002 I2S
   uninitialised (`i2s=0`) and the DMA streamed full-scale noise. The stock LC3 mono path keeps
   the SAME codec cleanly initialised (`i2s=1`, clean stereo DMA).
2. The app's audio sinks already converge: `SonicRadarStore.processedPCM` (beamformed 4-mic PCM)
   and the stock `micPcmHandler` feed the identical recognizer sinks
   (`localRuntime.forwardAudioChunk` + `phoneSideCaptions.ingest`).

So the model is: keep the stock codec RUNNING (I2S up, clean) and have the firmware tap take over
PCM slot 0 while it runs — the tap replaces the stock LC3 encoder callback, so no stock frames
are produced, but the codec/DMA stay clean and the tap gets valid samples. Never tear the codec
down, never re-init it, never hand back.

- **App (raw-PCM contract):** `G2.setCFWMicrophoneArrayEnabled` no longer disables the stock mic
  before arming; it calls `setMicEnabled(true)` to guarantee the codec is up (`i2s=1`) and arms on
  top of it. The stock `micPcmHandler` is gated on `SonicRadarStore.isSupplyingAudio` so the array
  is the sole recognizer source while it is delivering PCM (stock resumes only if the array stalls
  > 2 s). ADPCM contract keeps the old disable/settle dance.
- **Firmware (2.2.10.29):** the manager arming path, if `*CODEC_I2S_INIT` is set (codec already up),
  just registers the tap in slot 0 and returns — it does NOT prep/ctrl the codec. Only if the codec
  is down does it bring it up the stock way (codec-prep + ctrl). `WE_POWERED` is cleared in the
  tap-live case because the stock path owns the power.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.28.bin | dedc0c56da3d07f1d5ea623af1217348078e2f43231d4b1bfd4cba1acc78f731 | 3756254 B, 564a1716ad08aca367d39af4fb1a6e2a750159813a6975775dd83d495fa9dc6a |
| g2-2.2.10.29.bin | 9bb24bd840d0dcb2909917b19f100db27dc5456c5c6c742bf78869ef3e8fa650 | 3756282 B, 6349bffa1e411a36a03b70c353fabee9830f427ed38e721fc9db9d8f5552d675 |

## 2.2.10.29 result: the codec was clean pre-arm, arming tears I2S down (2026-09-14 14:33)

With the app keeping the stock codec up (raw-PCM path, `setMicEnabled(true)` before arming), the
pre-arm log reported **`i2sInit=true`** for the first time — the codec was cleanly initialised
right up to the moment of arming. One captured frame came through clean (`peak/rms=0.012/0.006`),
proving the tap-a-live-codec model can work. But the armed status then read `i2s=0 codecOn=1
dma=0`, and most frames were still saturated: **the act of arming (stealing PCM slot 0 from the
live stock codec) tears I2S back down.** A pair reboot also occurred.

Mechanism (narrowed, not yet fixed): the tap replaces the stock LC3 encoder callback in slot 0,
so the stock audio path loses its consumer; the stock audio-manager (or the 2-second codec-audio
watchdog, which reboots the codec when it sees no fresh DMA frames — `dma=0`) then tears the codec
session down and deinitialises I2S. The tap already clears `CODEC_ON_FLAG` to suppress the
codec-audio-check, so the remaining teardown path is the stock audio-manager reacting to losing
its slot-0 consumer, or a DMA-frame-count starvation the flag-clear does not cover.

Well-scoped next step (firmware): keep the stock audio-manager's own session alive while we tap —
e.g. hold its app-slot and keep `DMA_FRAME_COUNT` advancing so neither the manager nor the
2-second check tears the codec down — so I2S stays initialised (`i2s=1`) for the life of the tap.
The app side of the design (4-mic as the sole source feeding the whole pipeline, no hand-back) is
complete; this is the one remaining firmware detail.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.29.bin | 9bb24bd840d0dcb2909917b19f100db27dc5456c5c6c742bf78869ef3e8fa650 | 3756282 B, 6349bffa1e411a36a03b70c353fabee9830f427ed38e721fc9db9d8f5552d675 |

## 2.2.10.30 result: slot-hold helps the LEFT, RIGHT temple still uninitialised (2026-09-14 15:05)

Holding an audio-manager app-slot on the left (slot 7) while tapping worked as intended — the
armed status shows `slots=0xa0` (our slot 7 + a stock slot), so the manager keeps a client
registered. The result splits cleanly by temple:

- **LEFT temple: partially clean.** Per-channel peaks dropped from a constant 1.0 to a mix of
  0.44–0.76 and 1.0 across frames (e.g. `0.995/0.156 0.471/0.058`, `0.446/0.090 0.757/0.077`) —
  the codec is now producing real audio, intermittently, instead of pure free-running noise. The
  status still reads `i2s=0` even while real audio flows, so the I2S-init flag is not a reliable
  readiness signal here; the audio is what matters and it improved.
- **RIGHT temple: still pure noise.** Every right-temple frame is `1.0/1.0` on both mics. The
  right has no `service_audio_manager` (that path is LEFT-only), so `prep + ctrl` is the only
  bring-up available and it does not produce valid capture on the right — the right codec's I2S
  never initialises for our path.

So the capture problem is now two separate problems: the left is close (residual intermittent
saturation on a codec that is otherwise producing real audio), and the right needs a working
clean codec bring-up that does not depend on the left-only audio manager. A pair reboot still
occurred during the cycle.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.30.bin | dfc9d4e16c65527841ad594e9fd6aeacbb0296f9411c3605b46dbd051e771708 | 3756358 B, d2a50a366b635c0737dce627e33b178dc14e9ba2db86884da45e84ac7e873a01 |

Open questions for the next pass:
1. RIGHT temple: how is its codec meant to be brought up? Options to investigate — does it have a
   production/PDM init that sets its I2S, or does it also expect an audio-manager acquire that we
   must replicate side-agnostically? Get the right temple's own codec-cell diagnostics (currently
   the status mirror is left-biased) to see its i2s/power state directly.
2. LEFT residual saturation: whether it is a gain/AGC setting the stock LC3 path applies that our
   raw tap bypasses, or the beamform pairing mixing the clean left with the noisy right.

## The array capture is intermittent, not uniformly broken (2026-09-14 15:12)

Re-examining the earlier session's recordings changed the picture. The array's beamformed output,
recorded to the app's spool, varied in quality across arms that same night:

| recording | duration | overall | note |
|-----------|----------|---------|------|
| assistant 02-54-26Z | 270 s | −18.9 dB, peak 1.000, active 0.99 | full-scale NOISE |
| assistant 03-22-40Z | 277 s | −33.5 dB, p10 −56.1 | speech-range, quiet |
| assistant 03-27-43Z (`array-a16c.wav`) | 561 s | peak 0.212, RMS 0.003 | CLEAN |

So the raw four-mic tap CAN produce clean audio (a16c is nine minutes of it), and did on 2.2.10.16,
whose capture path (`FW_CODEC_MIC_INIT` production init + register tap, non-manager) is byte-for-byte
identical to the current non-manager branch. Running that same path today (managerArming=false,
keep-codec-up app) still produced full-scale noise. The code is not the variable; the codec's state
at the moment of arming is. Some arms land the codec in a good state (clean capture), most land it in
the free-running-noise state. The 2.2.10.30 slot-hold pushed the LEFT temple into the good state
partially (real audio with intermittent clipping); the RIGHT stayed noisy.

This means blind arming-sequence iteration is the wrong tool — the fix needs to identify, from the
codec-cell diagnostics, exactly which arm-time state yields clean capture, then make arming
deterministically reach it. Concrete next step: dump the raw per-temple decoded PCM to WAV during a
run, arm repeatedly, and correlate each arm's clean/noisy outcome with the pre-arm codec cells
(i2s/power/codecOn/slots) so the good state can be named and forced.

## Persistent noise regime — suspect GX8002 codec state (2026-09-14 15:16)

A 6-cycle correlation run was uniformly noisy: 0 of 60 left frames clean, even in the two status
samples where I2S had reached `i2s=1`. So this is not a per-arm coin-flip today — the whole session
is stuck in the noise regime, whereas the earlier day produced 9 minutes of clean capture on
byte-identical firmware. The GX8002 voice codec is a separate chip with its own firmware and its own
reboot path (codec-control op 2, a ~1.75 s blocking GX8002 reboot) that none of this session's
experiments have triggered; the "reboot" we do (device-setting quick-restart) restarts the Apollo
host, not the GX8002. Repeated codec-control sequences (ctrl(0)/ctrl(1)/prep/cold-cycles) across the
day are a plausible way to have left the GX8002 in a persistent bad state.

Definitive test: a full hardware power cycle of the glasses (fully off/on via the case, not a soft
reboot), then re-arm and check the per-channel levels. If clean capture returns, the GX8002-state
theory holds and arming should trigger a GX8002 reboot (codec ctrl(2)) when it detects the noise
signature (sustained peak ≈ 1.0). If it stays noisy after a power cycle, the cause is elsewhere.

## BREAKTHROUGH: the GX8002 codec was wedged; rebooting it restores clean capture (2026-09-14 15:40)

2.2.10.31 issues a GX8002 codec-chip reboot (codec-control op 2, the chip's own firmware-level
reboot) at arm time, then reconfigures and enables it. With the glasses in their case and the room
quiet, the RIGHT temple went from constant full-scale noise to a clean quiet-room floor:

| candidate/state | right-temple per-channel |
|-----------------|--------------------------|
| .30 and earlier | peak 1.000, RMS ~0.25 (free-running codec noise) |
| .31 (GX8002 reboot) | peak 0.004–0.025, RMS 0.002–0.007 (clean; matches the stock LC3 mic floor) |

Confirmed reproducible: a 3-cycle run gave 22 clean right-temple frames, 0 noisy, with real varying
direction estimates. The root cause of the whole array-noise saga was a persistently wedged GX8002
voice codec; nothing in the session had ever rebooted that chip (the phone-side "restart" restarts
the Apollo host, not the GX8002), so the bad state carried across every candidate and every soft
reboot. This is why identical capture code produced clean audio on an earlier day and noise later.

Two follow-ups from .31: the LEFT temple (on its slot-hold/stock-sharing path) never streamed, and
the RIGHT streamed ~20 s late because the stock 2 s codec-audio-check reboot-looped the codec until
the tap settled it.

## 2.2.10.32: symmetric GX8002 reboot on both temples

Both temples now use one self-owned path: reboot the GX8002, reconfigure (prep), enable I2S (ctrl 1),
and immediately clear `CODEC_ON_FLAG` so the codec-audio-check does not reboot-loop while the codec
settles. No audio-manager slot hold and no stock-mic dependence — the four-mic array fully owns the
codec on both temples. The app's raw-PCM arming is correspondingly simplified: it no longer touches
the stock mic (`setMicEnabled`), it just arms; the firmware owns the codec.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.31.bin | 3fec074f6dd20c5a526eb5bbb958c5bab6fa0b1bc58b205e6a79461c0f92dde0 | 3756334 B, 78edfdd3bc69be2a550d3ebafb0938a3778188244a8d234f79aecd0485e8badb |
| g2-2.2.10.32.bin | 0c84518cc9110120c4445237b8979a95756e89f7a7ac415e0f9f6ab8cd40bd9c | 3756270 B, 506274b23e08c224031ef98aeb553f786cc59ca0dcd32bbe757664370cce4cf6 |

## Per-temple whack-a-mole and the inter-temple DMIC sync (2026-09-14 16:30)

Rebooting the GX8002 clears the wedge but a codec reboot also fires the boot-time inter-temple
sync that closes the OTHER temple's DMIC, and the ~1.75 s blocking reboot can drop the rebooting
temple's own BLE link. So the two temples fight:

| candidate | arm order | reboot | LEFT | RIGHT |
|-----------|-----------|--------|------|-------|
| .32 | left-first | both | silent (DMIC closed by right's reboot) | clean |
| .32 | right-first | both | streams, noisy | streams, noisy |
| .33 | right-first | right only | **clean** (RMS 0.005, real bearings) | 0 frames, link dropped/pair reboot |

So the LEFT is clean from a plain bring-up (no reboot needed) when it arms last and reopens its own
DMIC; the RIGHT's reboot is what un-wedges it but also disrupts its link. Since the GX8002 keeps its
state across Apollo-host soft reboots, once a reboot has un-wedged the right codec the wedge should
stay cleared, so steady-state arming should not need a reboot at all.

## 2.2.10.34: plain bring-up both temples, out-of-band recovery

Both temples do a plain configure + I2S enable with no reboot in the arm path (right-first arming so
the left reopens its DMIC last). The design intent: a wedged codec is recovered out of band — the
phone detects the sustained full-scale-noise signature and asks for a targeted GX8002 reboot — rather
than rebooting on every arm and disrupting the link. This candidate tests whether, after the earlier
reboots un-wedged the right, both temples now capture clean from a plain bring-up.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.33.bin | e592ec1197122f32e96e182968194de6f41a12b11066e986e383ae59d13aaea7 | 3756290 B, e813e3588c0d69cd2b19d6674f002d55e248a38ca063136fabeab645aaf56e15 |
| g2-2.2.10.34.bin | 77830d5bc34ca50c3b91fd5bffa27fad01a469789fc8d8de2cb8024b87d7f9b3 | 3756262 B, 0256c8f3792c8a507ed4e1820bf138f4b4bfe5fe8e78162db4d12b7b4ad69241 |

## 2.2.10.34 result: the GX8002 reboot is the ONLY clean bring-up (2026-09-14 16:50)

Plain bring-up on both temples (no reboot) put both back to full-scale noise (L 0/65 clean, R 1/53).
So the codec reboot is not clearing a persistent wedge that then stays cleared — the reboot's own
initialisation is the only bring-up that produces clean audio; a plain `prep + ctrl` always yields
the codec's free-running noise. Two firm conclusions from the .31–.34 sweep:

1. **`codec_ctrl(2)` (GX8002 reboot) is required for clean capture.** Plain configure+enable = noise.
2. **One temple's reboot cleans BOTH temples via the inter-temple sync.** In .33 the LEFT was clean
   from a *plain* bring-up because the RIGHT had just done `ctrl(2)`; the right→left codec sync that
   the reboot fires re-initialises the left's codec cleanly too. The cost is that the rebooting
   temple (the right) loses its own BLE link / triggers a pair reboot (its ~1.75 s blocking reboot
   likely overruns the 720 ms supervision the phone granted).

So the remaining problem is purely coordination: get one temple to issue the `ctrl(2)` that cleans
both, without that temple losing its own stream. Candidate approaches for the next pass:
- Reboot the codec once during a dedicated "reset" phase (tolerate one reconnect), then plain-arm
  both in the same session so the freshly-rebooted codecs stream clean (a plain arm right after a
  reboot is clean; only a plain arm from cold is noisy).
- Or negotiate a longer supervision timeout before the reboot so the link survives the 1.75 s block.
- Or find the specific step in the reboot's init that plain `prep+ctrl` omits and add just that,
  avoiding the reboot's link disruption entirely.

Best single-temple result to date: 2.2.10.33 gave the LEFT temple a fully clean quiet-room capture
(RMS ~0.005, real bearings) with the right rebooting; the two-temple simultaneous case is the open
item.

## 2.2.10.35: one-shot GX8002 power-cycle per host boot (the intended production design)

With the wearer's directive that CFW and SybilSight are always used together and the CFW may change
in any way, the .31–.34 facts resolve into one design:

- The GX8002 produces clean audio ONLY after its power-cycle (`ctrl(2)`: off → 100 ms → on →
  re-init). A plain configure+enable from cold is always free-running noise (.34); a plain bring-up
  right after a power-cycle is clean (.33). One temple's power-cycle cleans both via the codec sync.
- The only cost of the power-cycle is that its ~1.75 s blocking reboot overruns the phone-granted
  720 ms link supervision, so the rebooting temple's link is rebuilt; the phone already treats an
  armed link rebuild as "pair rebooted; re-arming" and re-arms 2 s later.

So .35 power-cycles the codec **exactly once per host boot**, on the first arm. That arm may cost a
link rebuild; the re-arm finds the one-shot flag set and does a plain bring-up on a freshly-cycled,
clean codec — both temples, no further reboots or link disruption for the life of the boot. The
flag `mic_codec_cycled` is the context's formerly-unused `als_reserved` spare (renamed via an
overlaid `cfw_context.h`; same size and position, zero layout risk); it lives in reserved RAM, so it
survives link rebuilds and resets only with a host reboot. On a CFW build the four-mic array is the
sole microphone, so nothing else re-wedges the codec between boots.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.35.bin | c2f7cb3bb3c123866568c82b7555c7f4dd218b4b489fb81f42d60523ecd70f04 | 3756286 B, 184c8082f2b057e16e9f65725916572939c3830960b1c2be82b9d066a47ef46c |

Expected on hardware: cycle 1 absorbs the one-shot reboot (possibly a rebuild + re-arm); cycles 2+
show BOTH temples clean (RMS ~0.005 in the quiet case) with first frames in ~1–2 s.

## .35 on hardware, and 2.2.10.36: let the codec calibrate before tapping (2026-09-14 17:25)

2.2.10.35 (one-shot power-cycle) proved the design but exposed one more ingredient:

| run | LEFT | RIGHT | note |
|-----|------|-------|------|
| 3 rapid cycles | 25 clean / 0 noisy | 18 clean / 13 noisy, last frames clean | both reach clean; the noisy right frames are cycle 1 during the one-shot reboot |
| 1 sustained 100 s arm | 0 clean / 43 noisy | 1 clean / 48 noisy | tapped immediately after the power-cycle → noisy for the whole 100 s |

The discriminator: the cycled arms went clean because the DISARM between cycles left the codec
alone for a while after its power-cycle; the sustained arm tapped it straight away and never went
clean. That matches the GX8002's post-power-on **MicDelay calibration** (the driver strings show it
retries up to three times): consuming the DMA while it calibrates breaks the calibration, and the
codec then streams free-running noise indefinitely.

2.2.10.36 therefore defers the tap. On the one-shot arm it power-cycles the codec and then leaves it
running UNDISTURBED — PCM slot 0 empty, the stock fallback consuming, no tap — for a
`MIC_CODEC_SETTLE_MS` (10 s) window, then a settle-timer callback (`mic_settle_tick`) completes the
bring-up (prep, I2S on, suppress the codec-audio-check) and only then registers the tap. Any arm
that lands before the codec is ready (including the re-arm after the link rebuild the power-cycle
costs) defers to the same ready tick; a STOP during the window cancels the deferred bring-up. Two
context fields were added (`mic_settle_timer`, `mic_codec_ready_tick`); once ready, later arms tap
immediately. On a CFW build the four-mic array is the sole microphone, so nothing re-wedges the
codec between host boots.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.36.bin | ef142794881a0a943b508d6635d3006baaa643bf732e3ab6896f6fa63192c258 | 3758618 B, 4a061a79cbaad3cf90297605483e45133b588c554809430c95c9fbdea88b1c24 |

Expected on hardware: first frames ~10–12 s after the first arm, then BOTH temples clean (RMS
~0.005 in the quiet case) for the rest of the sustained window with no further reboots.

## .36 on hardware, and 2.2.10.37: re-initialise I2S on the booted chip (2026-09-14 17:45)

2.2.10.36 (one-shot power-cycle + 10 s undisturbed settle, then tap) was still noisy on both temples
for its whole 120 s sustained arm (L 0/63, R 0/71 clean in steady state; first frames at ~26 s, so
the settle did run). So "quiet time with I2S on" is not the ingredient. Re-reading every clean arm
gives the real one: each had an **I2S deinit → gap → re-init** (`ctrl(0)` … `ctrl(1)`, i.e. the
disarm/re-arm gap in the cycled benches) *after* the power-cycle, whereas the two noisy sustained
arms (.35, .36) kept I2S continuously on from the power-cycle onward. The physical reading: the
power-cycle's own I2S init runs while the GX8002 is still booting, so the Apollo I2S locks to garbage;
re-initialising I2S once the chip is fully up locks it correctly.

2.2.10.37 makes the settle two-stage: after the one-shot power-cycle, stage 1 (8 s, chip boot) issues
an I2S deinit (`ctrl(0)`) on the now-booted chip; stage 2 (1 s later) does the configure + I2S
re-init and only then registers the tap. A STOP mid-settle cancels it; later arms tap immediately.
Context gained `mic_settle_stage`.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.37.bin | c27c27088f7bbef2b2e80b3ae18f19323665b57943168b2e07feeda689356a83 | 3758318 B, 538bb537fe5e30dbc67e96ddae50bf22fdaeab8efa137131c4033b1187339a59 |

## The context survives resets and re-flashes: .36/.37 never ran their one-shot (2026-09-14 18:05)

The .37 sustained arm showed the LEFT temple streaming at 34 ms — it never deferred — so
`mic_codec_cycled` was already 1. `peekCustomCfwContext` validates only a fixed magic
(`0xC0FFEE6A`) on a pointer in the reserved SRAM tail, and that SRAM persists across warm resets
AND OTA re-flashes. So the one-shot flag set by .35's first arm was reused by .36 and .37, which
therefore never power-cycled the codec or ran their settle at all — they did an immediate plain arm,
which .34 already proved is noise. Worse, the context struct grew across .35→.37 while the magic
stayed the same, so the newer candidates' added fields were reading past the end of the older
struct. Both .36 and .37 results are void for the same reason.

2.2.10.38 fixes both in the CFW:
- `ctx_size` is stamped at creation and checked on every peek, so any layout change recreates the
  context instead of reusing an older layout.
- Host-reboot detection: the OS ms tick restarts at boot, and the phone talks to the temple
  constantly (arm, renew every 30 s, status). If the tick is ever lower than at the previous mic
  control op (`mic_last_seen_tick`), the host rebooted in between — the GX8002 is back in its
  stock-boot (tap-noisy) state — so the one-shot flag is cleared and the next arm power-cycles
  again. This is what makes "once per host boot" actually true.

With those, the .37 two-stage settle (power-cycle → 8 s chip boot → I2S deinit → 1 s → I2S re-init
→ tap) runs for the first time on hardware.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.38.bin | ec8f6a5c279243087f7a79ebb0d7789667f255472ab05bc2f6a078356492254d | 3759106 B, 36e6192e0a5772a6a19a25d9621ebd749961890c64493535a4de125831d61434 |

## .38 on hardware: first fully clean sustained capture — and why the left was silent (2026-09-14 18:25)

With the size-validated context and reboot detection, the one-shot settle ran for real. Result of
the 120 s sustained arm:

| temple | first 30 s | steady state | note |
|--------|-----------|--------------|------|
| RIGHT | 20 clean / 0 noisy | **88 clean / 0 noisy** | RMS 0.003–0.004, real bearings, **no link drop** |
| LEFT | — | 0 frames | never streamed |

The RIGHT's clean session had in fact started right after the .38 flash reboot (its firmware frame
counter was already at 25 588 when the bench arm ran — ~5 min of clean streaming from the
one-shot + settle), and the bench's later re-CONFIGURE on that clean codec stayed clean. So the
design holds: **once the codec is power-cycled and re-initialised on the booted chip, plain re-arms
are clean.** And the power-cycle no longer cost a link drop.

The LEFT never completed its settle because the phone fought it: its silent-side retry
re-CONFIGUREs a silent temple every 3 s, and each re-CONFIGURE ran `mic_session_stop`, which
cancelled the in-progress settle and restarted it (three "settle #N re-CONFIGURE left" lines, no
left frames); a mode-11 cleanup had killed the very first settle too.

## 2.2.10.39: CONFIGURE is idempotent during the settle

While `mic_settle_stage != 0`, a CONFIGURE is treated as a lease renewal (refresh lease, answer
status) instead of a stop/start, so the phone's retries can no longer cancel the deferred
bring-up. Nothing else changes.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.39.bin | 7c01ddc9bee3cd0bff2b433d5a184506b9cc8f9723bdc90f1ca7823e1e05b919 | 3759118 B, a40d40f979deb48ea5c08b61da77f5f522d04ccb6fd41870aa196a3d334f1d42 |

## .39 on hardware, and 2.2.10.40: only the right power-cycles (2026-09-14 18:45)

2.2.10.39 reproduced the clean right temple (105 clean / 1 noisy over 120 s, RMS 0.003) but the
LEFT still streamed 0 frames with the identical arming timeline — so the retries were not the
left's real problem. Lining up every candidate by what the LEFT did:

| candidate | LEFT did | LEFT result |
|-----------|----------|-------------|
| .33 | plain bring-up (RIGHT power-cycled) | **32 clean / 0 noisy** |
| .35–.39 | its own `ctrl(2)` power-cycle | 0 frames, every time |

The left's own power-cycle is what silences it. The right's power-cycle fires the inter-temple codec
sync (right→left DMIC close/reopen) that re-initialises the left's codec as well, so the left only
needs a plain bring-up — timed after that sync has run. 2.2.10.40: only the RIGHT issues `ctrl(2)`
and the two-stage I2S deinit/re-init; the LEFT skips the cycle and defers a single plain bring-up
`MIC_LEFT_SETTLE_MS` (12 s, longer than the right's 8 s + 1 s + 1.75 s reboot) so the right's cycle
and the sync have completed. The phone arms right-first ~1.5 s ahead of the left, so the left's
window comfortably covers the right's.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.40.bin | cc3ce0ff0560614ff918bd0abe94c12f2f9b8c07fb34110cbcc8459f44c334c6 | 3759174 B, 69924cab10ce79079535524159c10f3e408229d5272f4e21563de0c216de37e3 |

## .40 on hardware: the LEFT is now fully clean; the right's link drop is the last defect (2026-09-14 19:05)

2.2.10.40 (right-only power-cycle, left deferred plain bring-up) produced the **first fully clean
sustained LEFT temple: 93 clean / 0 noisy over 120 s** (RMS 0.003–0.007, real bearings) —
confirming the .33 reading exactly. But the RIGHT dropped its BLE link during its own `ctrl(2)`
and never recovered (0 frames; "Disconnected RIGHT", "pair rebooted"). Both temples have now each
been proven fully clean; the one remaining defect is that the right's power-cycle intermittently
drops its link (.33/.40 dropped, .38/.39 did not).

Reading the reboot handler (0x595c12) with the on-path (0x556404) explains the intermittency.
With op 2 the handler does power off → 100 ms → power on and skips its own delay, then the
codec-control on-path runs the I2S init IMMEDIATELY — before the GX8002 has booted — so I2S locks
to garbage (the .37 finding), and the on-path's codec UART transactions (`gx8002_send_and_wait_
response`, retried) run against a still-booting chip: that is the variable, sometimes-long block
that overruns the 720 ms link supervision.

## 2.2.10.41: non-blocking, correctly-timed power-cycle from the CFW timer

The RIGHT no longer uses `ctrl(2)`. The CFW calls the driver's own primitives — `gx8002 power off`
(0x5959b8) and `gx8002 power on` (0x595904), both also called directly by stock's UART test
dispatcher from a non-audio thread — sequenced by the settle timer: power off → 100 ms → power on →
8 s chip boot → then the single I2S init (via `prep + ctrl(1)`) on the booted chip, then the tap.
Correct timing by construction, and no call ever blocks long. The .37 deinit/re-init dance is gone
because no early I2S init happens in the first place. The LEFT is unchanged (deferred plain).

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.41.bin | cbb6715f63159dbbff69957b87424e11a36ca4882d4c355316c38334a03849aa | 3759238 B, def8b3af5137479a1617c79028b466bf66d29c9ecc0ef4aca7e378ce7d9eb066 |

## .41 result and where the two-temple problem stands (2026-09-14 19:24)

2.2.10.41 (non-blocking timer-sequenced power-cycle) again gave a **fully clean LEFT** (110 clean /
0 noisy, RMS 0.002–0.008) but the RIGHT still dropped its link and produced 0 frames. So the link
drop is not caused by the reboot op blocking — the non-blocking primitive path drops the right too.
Powering the right codec off/on itself intermittently costs the right's link.

State of the whole investigation, plainly:

- **Root cause fully understood and fixed:** the GX8002 needs a power-cycle (off → delay → on) then
  an I2S init on the booted chip to capture cleanly; a plain init from stock-boot state is
  free-running noise. The context persists across warm resets and re-flashes, so the power-cycle
  must be gated once-per-host-boot (tick-backwards detector).
- **Each temple proven fully clean, individually:** LEFT 90–110 clean/0 over 120 s in .33/.40/.41;
  RIGHT 105+ clean/0 in .38/.39. RMS ~0.003–0.007 in the quiet case, real bearings, no drift.
- **Not yet simultaneous:** the temple that does the power-cycle intermittently drops its BLE link
  and, depending on the candidate, either recovers (RIGHT in .38/.39) or does not (RIGHT in
  .40/.41). Which temple ends up clean has tracked which one cycled last / recovered, not a
  fundamental limit — both work, just not in the same run yet.

The remaining work is making the post-power-cycle link rebuild deterministic to recover from: after
the cycling temple reconnects, both temples should complete a plain, correctly-timed bring-up on the
already-clean codecs (the codecs are clean by then — the cycle's inter-temple sync cleaned both).
That is an app+firmware recovery-sequencing task on top of a mechanism that now demonstrably
produces clean four-mic audio.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.41.bin | cbb6715f63159dbbff69957b87424e11a36ca4882d4c355316c38334a03849aa | 3759238 B, def8b3af5137479a1617c79028b466bf66d29c9ecc0ef4aca7e378ce7d9eb066 |

## ROOT CAUSE of the link drop: the codec power-off releases a shared rail (2026-09-14 19:40)

The disconnect the phone logs for the cycling temple is **"The connection has timed out
unexpectedly"** — a supervision timeout — and it fires **772 ms after CONFIGURE**, i.e. the
temple's radio went silent the instant the codec was powered off (power-off is synchronous at
CONFIGURE; the granted supervision is 720 ms). The codec driver's power path (`drv_gx8002b.c`,
confirmed both by disassembly and by openCFW's reconstructed source) writes three *logical* pins
through one dispatcher (0x5200b8):

| logical pin | handler | what it really is |
|-------------|---------|-------------------|
| 7 | 0x520198 → GPIO write 0x8f | Apollo **GPIO 143** — codec enable/reset line |
| 8 | 0x5201ae → GPIO write 0x92 | Apollo **GPIO 146** — codec enable/reset line |
| **6** | 0x52013c | **not a GPIO**: enters a critical section (`mrs primask; cpsid i` at 0x47a838), sets/clears bit 6 of a rail-request mask at **0x200765fc**, then drives **Apollo GPIO 134** high if the mask is non-zero and low if it is zero — a shared regulator enable |

Power-on raises 6, then 7 after 5 ms, then 8 after 20 ms (rail first, then the codec's own
lines); power-off drops all three at once. Two subsystems request pin 6 — the codec driver and an
audio-manager/thread-audio path at 0x56b172 — and both use the **same bit**, so the mask is not a
real reference count: the codec's power-off zeroes it and **GPIO 134 drops the rail regardless of the
other client**. On the RIGHT the codec driver is the only client, so power-off drops the rail
outright. That rail feeds something the EM9305 radio depends on (a shared regulator; openCFW has no
schematic for it, but the 772 ms timeout is the proof), the radio browns out or its SPI path
errors, and — per openCFW's Cordio driver — `open_cfw_hci_driver_recover()` shuts the radio down
and issues `DmDevReset`, dropping every connection. openCFW notes nobody has run the codec on
hardware, so this rail sharing is new information for that project.

**The better patch follows directly: reset the GX8002 through its own lines (logical pins 7 and 8,
GPIO 143/146) and never touch pin 6, so the shared rail stays up.** The codec still gets a hard
reset (its enable/reset lines are cycled with the stock 5/20 ms sequencing on the way up), the
radio never loses its supply, and the link never times out.

## 2.2.10.42: rail-preserving codec reset (the better patch)

The RIGHT resets its GX8002 through logical pins 7 and 8 only (GPIO 143/146): both low → 100 ms →
143 high → 20 ms (the stock on-sequence stagger) → 146 high → 8 s chip boot → single I2S init on the
booted chip → tap. Pin 6 (the GPIO 134 shared-regulator enable) is never written, so the rail and
the radio stay up. Otherwise as .41 (LEFT deferred plain, once-per-boot gate, idempotent CONFIGURE).

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.42.bin | 173468ba6513023c5280a4477834eb0809bcc96e4a045bb00fed80db8f29c089 | 3759294 B, e59c9a9f7305b33a151b1ff05f8a1549330a30a3124bedb854d69f0722cea7fd |

## .42 result: pulling the codec lines still drops the right; the both-reset pattern (2026-09-14 23:42)

2.2.10.42 (pins 7/8 only, rail untouched) still lost the RIGHT's phone link — "connection timed
out" ~770 ms after CONFIGURE — and the right never streamed; the LEFT was clean again (84 / 1). So
pulling GPIO 143/146 low on the right drops its link even with the pin-6 rail up: the shared-rail
theory is at most part of the story. Lining every run up by which temple reset:

| runs | who reset | right link | outcome |
|------|-----------|------------|---------|
| .38, .39 | BOTH temples | **never dropped** | right clean; left silent (its own reset dropped the rail) |
| .40, .41, .42 | RIGHT only | **dropped every time** (~770 ms) | left clean; right silent |

That matches the inter-temple audio sync openCFW documents on frame 0x010C — a role-sensitive
close / low-power / reopen / init handshake the codec reset fires: with the LEFT healthy it runs
its full multi-step course and ties the RIGHT up past the 720 ms supervision; with the LEFT also
mid-reset it aborts at once. And the LEFT's own reset only silenced it because it dropped the rail,
which the pins-7/8 reset avoids.

## 2.2.10.43: symmetric rail-preserving reset

Both temples reset their own GX8002 through pins 7/8 with the deferred bring-up; the left's
special 12 s plain path is gone. The phone arms right-first with the left ~1.5 s behind, so both are
mid-reset together. Expected: no link drop on either side and both temples clean.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.43.bin | b1465f65b2348f80bdf92cfefe40284da2b727f08d8688b41b47127388f4eaf9 | 3759266 B, b0edef701c158f55e6d62e77adb09b5bfa9382f6a06db4cce133250f3fa72b43 |

## .43 result reframes it: the rail cycle is REQUIRED for clean audio (2026-09-15 00:02)

2.2.10.43 (both temples reset via pins 7/8 only, rail untouched) produced NOISE on both temples
(L 2/83, R 1/89) and the right still dropped once. So pulling only the GX8002 enable/reset lines
(GPIO 143/146) does not reset the codec to a clean state — the chip needs its actual power **rail**
cycled (the pin-6 / stock `ctrl(2)` path) to come up clean. That refines the picture:

- **Clean audio requires the rail power-cycle.** ctrl(2) (which cycles GPIO 134 + 143 + 146) gives
  clean capture (.38/.39 right, .40/.41 left); pins 7/8 alone give noise (.42/.43). The rail cycle
  is not optional.
- **The rail is coupled to the radio and/or the inter-temple sync.** Cycling it intermittently
  drops the cycling temple's link — but survivably: in .38/.39 (both temples ctrl(2), left-first)
  the RIGHT cycled its rail and stayed connected and clean. The drop correlates with *which*
  temple cycles and *in what order* relative to the other, not with the rail cycle per se.

Net: the noise problem is fully solved (rail power-cycle + I2S-init on the booted chip + once-per-
boot gate), and each temple has been driven fully clean and stable individually. The open item is a
multi-variable, intermittent link-drop during the required rail cycle whose survival depends on
inter-temple timing/order. Best stable single-temple configs on record: LEFT 110/0 with .40/.41
(right cycles, left plain, right-first); RIGHT 105/0 with .38/.39 (both cycle, left-first).

Reaching both-clean-and-stable needs a controlled one-variable-at-a-time sweep of {which temple
cycles, arming order, inter-temple stagger} against the rail cycle — best done with the wearer able
to confirm the hardware rail topology (whether the two temples truly share GPIO 134's regulator, or
each drives its own), since openCFW has no schematic for it and never ran the codec on hardware.

## .44 = stability but a stale context, and 2.2.10.45 (2026-09-15 00:24)

2.2.10.44 (both temples rail-cycle, LEFT completes later) ran with **zero link drops and both
temples streaming the whole 130 s** — the both-cycle approach is the stability answer. But both were
noisy and first frames came at 29 ms, i.e. the codec never actually cycled: .44's context header is
byte-identical to .43's, so `ctx_size` matched and the stale context (with `mic_codec_cycled` already
1 from the .43 run) survived the OTA re-flash. The once-per-boot gate skipped the cycle. So .44's
zero drops just mean nothing happened; it did not test the intended logic. (Also: the tick-backwards
reboot detector did not fire here — needs hardening.)

2.2.10.45 bumps the context layout (`mic_layout_rev`) so the stale context is discarded and a fresh
one is created (`mic_codec_cycled` = 0), forcing the real both-cycle-left-later sequence to run, and
adds an `MK` audio-path marker emitted when the power-cycle actually fires so it can be confirmed.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.45.bin | f7bf4ceede25008bad349c21ffe5346a4c2bd3d6a6f6be5940fc8f30e4460f80 | 3754158 B, 8c816854058dd5571d3828f2ff356f9f2f70d4f519c4397f97671c6a145d17d4 |

## .45: stability solved (both-cycle, 0 link drops); the left-while-cycling capture is the last bug (2026-09-15 00:44)

With the forced-fresh context, 2.2.10.45 ran the real both-cycle-left-later logic: **0 link drops,
both temples streamed the full 130 s, and the RIGHT was fully clean and stable (105 clean / 1
noisy, RMS 0.002–0.005).** The LEFT was 0 frames. So the both-cycle approach is the stability
answer — a right-only cycle dropped the right every time, both cycling never drops.

The whole map is now consistent and the remaining bug is isolated to one cell:

| | left cycles | left plain (no cycle) |
|---|---|---|
| **right cycles** | right clean + stable; **left 0 frames** (.38/.39/.44/.45) | right clean but **right link drops** (.40/.41/.42) |

Read together:
- **Right clean** ⟺ right cycles. **Right link survives** ⟺ left *also* cycles.
- **Left clean** ⟺ left does a plain bring-up (no cycle). **Left breaks (0 frames)** ⟺ left cycles.

So the left must cycle to keep the right's link up, but the left's own cycle breaks its capture.
This fits the openCFW ownership model: the LEFT temple is the `service_audio_manager` hardware owner
(role 2; "only role 2 touches hardware, first acquire resets shared state and enables PDM+codec"),
while the right's codec is independent. The left's power-cycle disturbs the shared audio-manager
state its own capture depends on; the right, independent, cycles cleanly. The last task is to make
the left recover its capture after the cycle it must perform — either give the left the same
I2S-deinit/reinit-on-booted-chip recovery the right uses (adapted for the audio-manager path), or
have the left re-acquire through `AUDM_appAcquire` after the cycle so the manager re-enables its
codec + DMA.

Also filed: the once-per-boot gate needs the tick-backwards detector hardened (it did not fire on
.44), and any candidate re-running a once-per-boot action after a re-flash must bump the context
layout (`.45` does).

Best all-round candidates today: **.45** (right clean + stable, 0 drops, left silent) and **.41**
(left clean + stable, right drops). Both-cycle is the stability foundation to build the left fix on.

## 2.2.10.46: the left re-acquires the audio manager after its cycle (openCFW-guided)

Both temples cycle (stable, per .44/.45); the LEFT — the `service_audio_manager` hardware owner —
now calls the stock manager acquire (`FW_AUDM_ACQUIRE`, 0x56ac64, LEFT-only) at the start of its
`mic_complete_bringup`, so the manager re-enables the codec/PDM/DMA its own power-cycle had reset,
before the left registers its tap; stop calls the matching release. This is the openCFW-recommended
fix for the isolated left-while-cycling zero-frames bug (the left's cycle tore down the shared audio
state its capture depends on). Fresh context is still forced (`mic_layout_rev`). If it holds, both
temples should be clean and stable with no link drops.

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.46.bin | 914c380fb66e6479c6b237899c032db9697a8f9892ca99a0143b14a89b391b76 | 3754258 B, 9cb0b0e019fffddc695d002e70e4aa223070143d4557084148dd6faabfd4d479 |

## .46/.47: the left re-acquire makes the left stream but disturbs the right (2026-09-15 01:27)

2.2.10.46 (left re-acquires the audio manager after its cycle) made the LEFT stream for the first
time when it cycles (was always 0 frames) — the openCFW-guided fix works. 2.2.10.47 (same, with a
forced-fresh context so the cycle actually ran) confirmed the cycle+settle executed (first frames
~30 s), but both temples were noisy and the right dropped once. The reason is structural: the LEFT
is the `service_audio_manager` hardware OWNER, and its acquire "resets shared audio state and
enables PDM + codec" — so the left's re-acquire, which fixes the left, resets the shared state the
RIGHT's clean capture depends on. In .45 (no left acquire) the right was clean and the left silent;
adding the left acquire streams the left but un-cleans the right. The two temples share one audio
state and each temple's bring-up perturbs the other.

Also confirmed: the OS tick does NOT reset across the OTA reboot, so the tick-backwards host-reboot
detector never fires; a production once-per-boot reset needs a real cold-boot startup hook (filed).

### Full mechanism map (from openCFW + disassembly), for the next design
- **Clean capture requires** a GX8002 power-rail cycle (`ctrl(2)`: GPIO 134 rail + 143/146 lines,
  off → 100 ms → on) followed by an I2S init on the *booted* chip; a plain init from stock-boot
  state, or pins 143/146 without the rail, is free-running noise.
- **Link drop** on a cycling temple = supervision timeout ~770 ms after CONFIGURE, from the rail /
  inter-temple disturbance; it does NOT happen when BOTH temples cycle together (both-cycle is the
  stability answer — 0 drops in .44/.45).
- **Two temples share audio state.** LEFT = `service_audio_manager` owner (role 2; "only role 2
  touches hardware, first acquire resets shared state + enables PDM + codec"); RIGHT's codec is
  independent. Peer coordination rides frame **0x010C** (close / low-power / reopen / init).
- **Proven individually:** LEFT 110/0 clean+stable (.40/.41), RIGHT 105/0 clean+stable (.38/.39/.45).

### Recommended next design (work WITH the manager, not against it)
Instead of resetting each temple's codec independently (which fights the shared state), have the
LEFT owner drive ONE coordinated bring-up through the stock audio manager — its acquire enables the
codec + PDM and runs the 0x010C peer handshake that brings the RIGHT up in lockstep, the stock way
— then both temples tap the result. That replaces the per-temple cycle races with the single
coordinated path the firmware already implements, and is the most promising route to both-clean-
and-stable. It needs the audio-manager acquire ABI (now reviewed: 0x56ac64) plus the peer-sync
entry points openCFW pins (`AUDM_SendSyncMsgToPeer` 0x54f694, `AUDM_HandlePeerSyncMsg` 0x54f6f4).

| candidate | sha256 | main payload |
|-----------|--------|--------------|
| g2-2.2.10.46.bin | 914c380fb66e6479c6b237899c032db9697a8f9892ca99a0143b14a89b391b76 | 3754258 B, 9cb0b0e019fffddc695d002e70e4aa223070143d4557084148dd6faabfd4d479 |
| g2-2.2.10.47.bin | 75f829864b9c92ecfdb08cd48c3769e698fab3dae6259e3f72beb214a6a592a9 | 3758038 B, 368562728e17cf00c50701a3fa294420b4487a24d72f224384647fa677bbbdc5 |

## 2.2.10.48 — the rail power-cycle is required (hypothesis rejected)

Test of "the GX8002 never needed the rail reboot, only I2S initialised after its
post-configure calibration": one-shot bring-up = LEFT `AUDM acquire` + `prep(1)` +
`ctrl(1)` on both temples, then the two-stage I2S deinit/reinit settle on both, **no
`ctrl(2)`**. Result on hardware (120 s arm, both temples): every frame noisy on both
sides (peak 1.0 / RMS ~0.25), 0 clean frames, plus one RIGHT supervision-timeout drop
16 s after CONFIGURE. Conclusion: clean audio genuinely requires the regulator
power-cycle (`ctrl(2)`), not just I2S timing. The .48 overlay is kept only as the
record of that experiment; .49 reverts the mic path to the .47 code.

## 2.2.10.49 — dirty-rectangle display present

`present_shadow` now records the union of the frame's updated rows (from the
`cfw_rectlist` the deltas already build) in `direct_dirty_top/bot`, unioning across
coalesced presents; `display_copy_hook` copies and dcache-flushes only those rows of
the 640x480 4bpp panel (`copy_panel_rows`) instead of all 153,600 bytes per frame.
The debug overlay rows (0..12) are always included while the overlay is visible; any
inconsistent range degrades to the full panel. Verification needs the display pipeline
exercised (the `w…us p…us` overlay is the budget signal); not yet measured.

## 2.2.10.50 — 2M PHY request + larger inflate chunk

- `MIC_FLAG_PHY_2M` (CONFIGURE flags bit3): on arm the temple calls Cordio `DmSetPhy`
  (2.2.10.10 0x4ddb04 / 2.2.9.22 0x4db278, found in both images via the unique
  `movw #0x2032` HCI LE Set PHY opcode) for the phone link (connection object at
  `*(0x20076594)`, connId at +4) with tx/rx = LE 2M. Stock never requests a PHY on the
  phone link (its only DmSetPhy caller is `RING_SetPhyProcess`). App knob:
  `sonicRadar.requestPhy2M`.
- `RLE_CHUNK` 256 → 1024 (fewer FW_INFLATE round-trips per frame; stack only).
- Fresh context layout (`mic_layout_rev4`).

## Inter-temple UART (peer link) — what is established

The temples talk over a UART carrying TinyFrame packets (openCFW `uart_sync.c`
recovery; TinyFrame core blobs; common-data frames such as 0x010C ride on it). The
2.2.10 image drives four UART instances through one first-party adapter over the
Apollo510 HAL (instance table 0x20000e38, 0x1c-byte entries, 16-byte HAL config
whose first word is the baud). The HAL's baud path carries a 3,000,000 ceiling check,
so the wire tops out at 3 Mbps (about 240 kB/s of 8N1 payload) regardless of
configuration. The configured peer rate itself is populated at runtime into RAM (no
ROM config struct matched), so it is still unread; the codec UART is documented at
115,200 (host) / 230,400 (DFU) / 1,500,000 (DFU stage 2). openCFW's addresses target
G2 2.2.6.10, not 2.2.10.10, so its symbol addresses do not map onto this image.

## 2.2.10.49 left-first runs and the 2.2.10.51 peer-sync hook

Left-first arming on .49 (app knob `sonicRadar.armLeftFirst`, optional
`sonicRadar.armGapMs`): both temples stream (~9,000 frames each in 120 s), 0 link
drops without the gap, 1 RIGHT drop with a 4 s gap, but every frame noisy on both
sides in both runs. The LEFT's field-104 shows `dma` advancing with `slots=0x20`
(our app id acquired) while its firmware frame count stays 0; the RIGHT shows a
window with `codecOn=0 i2s=0 sync=1` — the peer sync re-initialised it after its
cycle. That is the un-cleaning mechanism: every LEFT bring-up that goes through the
stock audio manager emits an inter-temple 0x010C sync and the RIGHT re-initialises
its codec without a rail cycle.

.51 makes the RIGHT deaf to that frame while armed: the common-data dispatch table
entry `{0x010C, handler, 0}` (2.2.10.10 rodata 0x6c12a0, handler 0x56b1f6; 2.2.9.22
0x6be5b0 / 0x56873a) is repointed at `mic_peer_sync_hook`, which swallows the frame
(counting it in `mic_peer_sync_ignored`) only when side == RIGHT, `MIC_FLAG_ARM_HW`
is set and the codec has been power-cycled, and tail-calls the stock handler for
everything else. Patcher site `AUDM_PEER_SYNC_TABLE_SITE` (4-byte Thumb pointer),
profile hook + rom-call `FW_AUDM_PEER_MSG_ORIG`. Mic bring-up otherwise = .47.

## 2.2.10.52 / .53 — the bench was racing the reboot; the fixes that follow from it

Re-reading the run logs: every "Disconnected RIGHT ... timed out" in today's runs came
1–2 s after the app's own `debug.rebootTempleOnLaunch=both; rebooting after a short
delay`, and the arm had landed ~2 s before the temples went down. The measured
sessions were therefore the re-arms after a reboot on a context that survived it:
armed, `settle_stage != 0` with a dead RTOS timer handle (or "active" with no tap),
so the CONFIGURE was treated as a renew, nothing re-armed the codec, and the temple
streamed the stock-boot (noisy) codec. The "rail cycle drops the link" story was a
bench artifact.

- .52: the rail cycle is staged over the settle timer (power off → 100 ms → power on →
  8 s boot/calibration → I2S deinit → gap → I2S init + tap) on BOTH temples; a
  stopped/lapsed session re-cycles on its next arm (per-session gate, not per boot);
  the RIGHT's peer-sync deafness became CONFIGURE flag bit4 (`sonicRadar.rightDeaf`).
- .53: (a) CONFIGURE masked the flags with the old 3-bit mask, so bits 3/4 (2M PHY,
  right-deaf) never reached the firmware — fixed to `MIC_FLAG_PUBLIC_MASK`; (b)
  reboot/stale-session recovery: a settle stage whose deadline passed, or an armed
  session more than 20 s old with no tap frame in 3 s, is torn down without touching
  its (possibly dead) timer handles and the arm starts over with a fresh rail cycle
  (`mic_recoveries` counts it).
- Bench: `array-cycle2.sh` reboots the pair in a first app launch, waits for the
  second authentication, quits, then runs the arm-cycle test in a second launch.

## 2.2.10.54 — LEFT fully clean (99/0), RIGHT killed by the display cleanup

.54: the RIGHT runs the stock blocking reboot (`ctrl(2)`: power-cycle with the immediate
I2S init the GX8002 evidently needs to boot and calibrate) then the .45 settle
(8 s → I2S deinit → 1 s → prep + I2S init + tap); the LEFT does no cycle and no manager
acquire, just the .41 plain bring-up deferred 12 s past the RIGHT's reboot and the
right→left sync. Two-phase bench, right-first, stock sync handling:

| temple | frames | clean / noisy | link drops |
|---|---|---|---|
| LEFT | 8,066 (first at 17.6 s) | 99 / 0 | 0 |
| RIGHT | 0 | — | 0 |

The RIGHT's status trace shows why it streamed nothing: 5 s after CONFIGURE the app's
display-page rebuild sent a mode-11 session cleanup, whose handler also called
`mic_cleanup_session` (codec off, session gone), then the app re-armed and its
silent-side retries re-CONFIGUREd every 3 s; the codec never came back
(`codecOn=0 i2s=0` from +4.7 s on) and the lease lapsed at +100 s. .55 removes the mic
teardown from mode 11 (the 90 s lease is the fail-open) and treats a CONFIGURE that
repeats the live configuration as a renewal instead of a stop/start.

## 2.2.10.55 — LEFT clean, RIGHT's capture never starts without a LEFT reboot

Same shape as .54 with the mode-11 teardown removed and idempotent CONFIGURE. LEFT
streamed clean for the whole window (frame log peak ≈ 0.005 / RMS ≈ 0.002 with a
live bearing), RIGHT: `codecOn=1 i2s=1 pwr=1 sync=1 dma=0` from its reboot to the end —
the codec is powered and clocked but its DMA never delivers. In every run where the
RIGHT did stream (.45–.53) the LEFT also ran `ctrl(2)`. Working model: the RIGHT's
capture is released by the LEFT owner's post-reboot peer handshake (the audio-manager
task's type-8 message; the handler table at 0x2000471c is filled at runtime, so the
message ids were not recovered from the image). .56 therefore reboots both temples
again, with the LEFT re-acquiring the manager and running the same I2S deinit/reinit
settle as the RIGHT — the first measurement of that shape on the fixed bench.

Bench note: phase 1 of `array-cycle2.sh` now runs with `sonicRadar.armHardware=false`
so the reboot launch cannot open a hardware session that the cycle launch inherits.

## 2.2.10.56 — both reboot again (fixed bench): both stream, both noisy

| temple | frames | clean / noisy | link drops |
|---|---|---|---|
| LEFT | 8,356 (first at 15.0 s) | 0 / 102 | 0 |
| RIGHT | 8,828 (first at 9.1 s) | 1 / 104 | 0 |

With .54/.55 (LEFT plain: 99/0 clean, RIGHT dma=0) this gives a consistent model on
the fixed bench: the CFW rail reboot (`ctrl(2)`) is what produces the noise, whatever
settle follows it, and every earlier "reboot + settle = clean" reading was taken on a
reboot-raced bench where the measured session was a re-arm that skipped the reboot.
Clean audio = the stock-driven codec init (boot, or the manager's re-open) left alone
through its calibration, then a late prep/I2S-on/tap. The RIGHT's capture is closed by
the LEFT's last stock release (the phone's stock-mic disable) and re-opened by the
LEFT's first manager acquire. .57 therefore has no reboot on either temple: the LEFT
acquires the manager at session start (re-opens both codecs the stock way) and both
temples tap 12 s later.

Also seen twice today: the Debug app stops writing SDK logs mid-stream while its main
thread is busy in CoreText/CoreGraphics (sample in the scratchpad); it then ignores
SIGTERM. Follow-up for the app: keep the frame log and the radar view off the main
thread's critical path during streaming.

## 2.2.10.57 — no reboot, LEFT acquire: LEFT clean until the RIGHT rebooted

| temple | frames | clean / noisy (first 45 s) | steady | link drops |
|---|---|---|---|---|
| LEFT | 8,434 (first at 11.8 s) | 26 / 8 | 0 / 64 | 0 |
| RIGHT | 5,848 (first at 46.5 s) | 0 / 9 | 0 / 72 | 1 (timed out 21 s after arm, then "pair rebooted") |

The LEFT streamed clean from its late tap until the RIGHT's reboot; the RIGHT's boot
sync then re-initialised the LEFT's codec under the live tap and it went noisy. The
"noise" signature (full-scale peaks, RMS ≈ 0.25) is I2S word misalignment: the manager
re-open initialises I2S immediately, before the GX8002 finishes calibrating, and a later
`ctrl(1)` is a no-op while I2S is already on. .58 restores the late I2S off → gap → on
on both temples in the no-reboot flow. The RIGHT's crash 9 s after its first tap is not
yet explained.

## 2.2.10.58 — late I2S off/on on both: both noisy (0 drops)

Both temples streamed from 13 s, zero link drops, every frame noisy. Against .57 (same
flow without the off/on, LEFT clean until the RIGHT rebooted) this shows the late I2S
deinit/reinit itself misaligns the word clock; it is not the fix. On the fixed bench the
LEFT's clean recipe is stable: stock-driven init (boot or manager re-open), untouched
for ~12 s, then prep + I2S-on + tap. The RIGHT has not yet come up clean in any shape.
.59 keeps the .57 flow and makes the RIGHT's bring-up selectable per CONFIGURE (bitrate
low nibble; app knob `sonicRadar.bringupVariant`): 0 = the LEFT recipe, 1 = I2S off →
prep → 8 s off → I2S on, 2 = I2S off → 1 s → on (no prep), 3 = tap only.

## 2.2.10.59 — RIGHT bring-up variants (fixed bench, fresh reboot each)

| variant (RIGHT) | LEFT clean/noisy | RIGHT clean/noisy | notes |
|---|---|---|---|
| 0 prep + I2S on + tap | 1 / 87 | 0 / 72 | LEFT status shows stock app 5 alongside ours (slots=0xa0) |
| 1 I2S off, prep, 8 s, I2S on | 7 / 76 | 0 / 71 | same |
| 2 I2S off, 1 s, I2S on | 27 / 55 | 0 / 49 | RIGHT crashed/rebooted at +20 s; LEFT clean until then |
| 3 tap only | **80 / 0** | no frames | LEFT clean the whole window, 0 drops; RIGHT dma never runs |

Reading: the LEFT's clean recipe is solid and is ruined only by the RIGHT's codec
operations (each sends a peer sync that re-initialises the LEFT and re-acquires the
stock voice app) or by a RIGHT reboot. The RIGHT's own capture only runs after a
prep/I2S-on, and its data is misaligned every time. .60 releases stock audio apps
while armed; .61 makes the LEFT deaf to peer syncs from arm and the RIGHT deaf once it
taps (bit4), so the two bring-ups cannot disturb each other. The RIGHT's word
alignment remains the open problem (candidate: capture its I2S DMA descriptor format
directly rather than through the stock PCM slot).
