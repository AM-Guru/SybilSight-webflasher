# Stock 2.3.0.24 + current g2flash foundation

## Current additive build: SybilSight/230.87

230.87 fixes a 230.86 identity mismatch: settings advertised .86 but the inherited
FI/v1 reply copied .84 from compiler-generated immediates. The builder now redirects
the guarded inherited identity entry to a function compiled with the release marker.
Emitted-code tests execute that entry for both lens roles and compare the complete
nonce reply. Post-install app verification requires the exact live bilateral marker.
The replacement remains offline-built; no physical flash is claimed.


Use `package_current.py` for the current candidate. It requires the hash-pinned `.84`
image and stock recipe, adds keyboard contract v1 from upstream commit
`46165ab41e8de70fdd1f8abf523137249afafde2`, then runs mandatory emitted ARM and sanitizer
checks. It also adds Guardian identity contract v1 on settings field 132. The
connected phone MAC strip is **off at boot** and requires a 30-second renewal
lease (`GI`, version 1, boolean). SybilSight only renews it when both Guardian
mode and its separate identity toggle are enabled. LEFT renders in the upper
24-row dashboard lane and RIGHT in the lower lane. Stock discovery does not
cache the connected phone's Device Name; each lens reports its own live Cordio
peer address, which may be a rotating privacy address. This is a diagnostic,
not an authenticated identity or access-control gate. Disable and lease expiry
schedule a stock dashboard repaint to remove the strip. Existing custom app
frames and sleeping glasses retain the parent's visibility rules.

The exact .84 parent compilation reproduces its 121,732-byte blob; reviewed
relative entries are queue 452, live snapshot 1116, overlay 1316. Packaging
checks their preimages against the full hash-pinned parent, redirects the single
overlay call and the existing display queue hook, and preserves the remaining
parent code and all non-main components.

Historical builders below reproduce earlier revisions; their revision-35
foundation omitted the revision-39 keyboard port.

```sh
python3 firmware/cfw/g2-2.3.0.24/package_current.py \
  --stock /path/to/stock-2.3.0.24.bin \
  --parent /path/to/g2-2.3.0.24-sybilsight-230.84.bin \
  --parent-recipe /path/to/cfw_patches-230.84.json
```

Python needs `unicorn` and `capstone`; clang supplies the ARM compiler and native
ASan/UBSan harness. Defaults use the existing sibling webflasher's verified archives.
Outputs are under `artifacts/cfw-2.3.0.24/keyboard-relay`. Only `.84`'s main-app component
changes: append the keyboard blob, chain settings/startup, install five reviewed hooks,
replace the identity marker, gate the dashboard strip, and update checksums. The codec and other five components
remain exact. The existing context ABI remains intact; a reserved SRAM word owns the
keyboard sidecar and is cleared on heap startup. Changed sources or stock ABI bytes
abort the build. Hardware validation is explicitly false in the recipe and manifest.
This process performs no flash or publication.

## Historical foundation and build options

This directory pins **jimrandomh/g2flash `993e585` (`Faceclaw/22`)** and builds from
the original stock **2.3.0.24** donor. It never rebases our old patch offsets,
changes another repository, accesses glasses, or publishes a release.

The upstream baseline is reproduced exactly. Experimental options are cumulative:

- `--port-mic-abi`: register/unregister argument order and four-argument angle ABI
  (`SybilSight/230.1`).
- Add `--port-rle`: aligned word-wise fill from our .72 codec (`SybilSight/230.2`).
- Add `--port-display-gate`: checked stock semaphore acquisition (`SybilSight/230.3`).
- Add `--port-context-layout`: size/magic validation with atomic publication (`SybilSight/230.4`).
- Add `--port-microphone`: adapted .72 lifecycle, four-channel LC3 relay and SM v2 ADPCM (`SybilSight/230.5`).

- Add `--port-display-pipeline`: bounded CPU row copies and worker-only timing calibration (`SybilSight/230.6`).

- Add `--port-radio`: correct Cordio ID bounds, pointer validation and HCI handle-zero support (`SybilSight/230.7`).

- Add `--port-dashboard`: stock dashboard phone-link status (`SybilSight/230.8`).

- Add `--port-microphone-lease`: independent microphone lifetime and checked watchdog (`SybilSight/230.9`).

The app recognizes exact 230.5 through 230.9 candidates for display and transport, with
matching markers required on both temples. Earlier experimental markers remain
unrecognized. Microphone hardware requires an explicit bench opt-in; this is
**not hardware-qualified microphone firmware**. See the [migration assessment](../../../docs/bluetooth/g2-2.3.0-migration.md).

From the SybilSight root:

```sh
python3 firmware/cfw/g2-2.3.0.24/build.py \
  --g2flash ~/Repo/g2flash \
  --stock ~/Repo/g2flash/g2_2.3.0.24.bin \
  --output artifacts/cfw-2.3.0.24

# Separate experimental candidate, using clang; leaves the baseline intact.
python3 firmware/cfw/g2-2.3.0.24/build.py \
  --g2flash ~/Repo/g2flash \
  --stock ~/Repo/g2flash/g2_2.3.0.24.bin \
  --output artifacts/cfw-2.3.0.24 --port-mic-abi

# Microphone-lease candidate (230.9); later cumulative flags are documented below.
python3 firmware/cfw/g2-2.3.0.24/build.py \
  --stock ~/Repo/g2flash/g2_2.3.0.24.bin \
  --output artifacts/cfw-2.3.0.24 --port-mic-abi --port-rle --port-display-gate \
  --port-context-layout --port-microphone --port-display-pipeline --port-radio --port-dashboard \
  --port-microphone-lease

python3 -m unittest discover -s firmware/cfw/g2-2.3.0.24 -v
```

Obtain the donor with g2flash's `build_cfw.sh --skip-venv`, which downloads and
hash-checks the official image. No firmware is included here. The baseline is
compiler-independent because it applies the committed upstream recipe. For the
experimental candidate, source compilation runs upstream's ROM/RAM inventory
and patch-footprint audit, and the resulting recipe is replayed independently
to its output hash. The candidate recipe and edited sources are saved alongside
the image; different clang versions may emit a different candidate hash.

`baseline.json` holds immutable input/output pins; `mic-abi-review.json` and
`display-abi-review.json` hold reviewed instruction bytes. The display port updates
only its explicitly reviewed source-literal inventory entries; upstream stock-hash,
other dependency guards and patch-footprint checks still run. Native C tests use
ASan/UBSan and the exact pinned upstream RLE decoder as a differential oracle. Original 2.3.0 version metadata is retained;
only the private contract marker distinguishes the experimental image. There is
no release-catalog entry and no claim of OTA upgrade eligibility or validation.

The optional read-only stock-audio tests require Python `capstone` and `unicorn`,
and the hash-pinned donor at `~/Repo/g2flash/g2_2.3.0.24.bin` (override with
`G2_STOCK_230`). They execute actual queue and encoder-setup instructions with
RTOS/logging/memcpy substitutes; they do not validate radio or full LC3 encoding.
See [microphone port review](microphone-port-review.md). The context regression
compiles the exact transformed source under ASan/UBSan and forces eight concurrent
allocations to verify that only one fully initialized context is published.

The microphone port reads the archived .72 source from
`~/Repo/SybilSight-webflasher/scripts/cfw/overlays/2.2.10.72/mic_control.c` (override
with `--microphone-source`) and rejects any SHA mismatch. No draft address map is
used. `microphone-abi-review.json` supplies the explicit source inventory, 147
additional instruction/literal guards and the reviewed peer registry write.
The native microphone test compiles the transformed C with stock facades replaced
by mocks; its emitted packets must exactly match the fixture decoded in iOS tests.

The display pipeline port preserves full-frame panel DMA. Both actual stock
panel callbacks ignore rectangle bounds in their fixed transfer descriptors;
`test_stock_display.py` executes that behavior, and `display-pipeline-review.json`
guards the reviewed instruction/data ranges. Native transformed-source tests
exercise dirty-row copying, rectangle overflow, failed shadow updates, overlay
removal, buffer replacement and timing calibration. See the
[display port review](../../../docs/bluetooth/g2-display-port-research.md).

`radio-abi-review.json` and `test_radio.py` supplement the microphone review:
three valid Cordio connection IDs, live HCI handle zero, pointer bounds and exact
stock command encoding. These tests compile and emulate the transformed helpers;
command submission is intercepted and no controller is contacted.

The dashboard source is separately pinned to `g2flash-amguru` commit `6f2cea3`
and read from `~/Repo/g2flash-amguru/patches/connection_status.c` (override with
`--dashboard-source`). Its one queue-receive hook and 12-byte fixed snapshot are
covered by `dashboard-abi-review.json`. Actual stock getter/compositor emulation,
native overlay tests and a rendered preview are described in the
[dashboard port review](../../../docs/bluetooth/g2-dashboard-port-research.md).

### Direct-lens identity qualification (230.10)

Add `--port-identity` after all 230.9 flags. Hardware OTA of 230.9 completed on
both lenses, but postflight could not prove a bilateral marker: a cold context
reported side zero and the stock settings sender used the RIGHT relay. See
`docs/bluetooth/g2-230-hardware-validation.md` for the captured response.

230.10 adds `MC/v1 op 5` with a four-byte nonzero nonce, returning before microphone
context allocation or lifecycle work. Each lens emits `FI/v1, side, nonce, marker`
on its direct stream-notify lane. The app requires matching current nonce, physical
source, exact marker and a five-second deadline for both lenses. Unknown/old/mixed
images cannot satisfy this proof. Empty-context settings also report the actual
producer side, so ordinary RIGHT telemetry remains attributable.

Bundle SHA-256: `bbb334bad754826f8d4397505adc23f9177931f46ed7d6192a680a7f59637c48`.
All five non-main payloads remain byte-identical to stock. Host tests validate
bounded allocation, failed allocation, nonce copy, producer side, malformed lengths
and dispatch before context allocation. Hardware qualification is still pending;
do not mark this candidate release-ready merely because OTA bytes were accepted.

### Codec lifecycle candidate (230.11)

Add `--port-codec-lifecycle` after `--port-identity`. This emits a separate
`codec-lifecycle-experimental` artifact, leaving 230.10 reproducible. On hardware,
230.10's stock audio was intelligible after a Case reset; arming the array caused
noise that persisted after STOP. Inter-temple sync isolation alone did not fix it.

230.11 avoids repeating DMIC/I2S startup on an already-running RIGHT codec and
leaves LEFT startup to its stock audio manager. Every LEFT session reacquires
slot 7, including after STOP; cold starts retain the calibration delay. This is
an experimental lifecycle hypothesis, not an acoustic qualification. Native
ASan/UBSan checks cover warm/cold startup, reacquisition and tick wraparound.
The exact marker remains gated by direct, per-lens nonce replies in the SDK and
webflasher. Neither a donor-version reply nor a persisted override can qualify it.

### Cold-RIGHT startup candidate (230.12)

Add `--port-codec-prewarm` after `--port-codec-lifecycle`. This builds the separate
`codec-prewarm-experimental` artifact. In 230.11 hardware diagnostics, tap-only
RIGHT left the LEFT stereo stream clean but produced no RIGHT frames; starting
RIGHT at the end of the settle interval corrupted both streams. The stock
PREP/CTRL entry points enqueue work, so returning from them is not readiness.

230.12 starts cold RIGHT before the existing 12-second interval, retains the
stock PCM consumer during that interval, and refuses tap installation if the
codec still reports unready. It preserves warm takeover and explicit diagnostic
variants. No new firmware addresses are introduced. This remains a hypothesis
requiring acoustic validation, not a release-qualified microphone implementation.

Bundle SHA-256: `e7fe637d7ee5ce889976ee4f82a1bb9c67a50bd3a33ce98be7c373a8cc546553`.
The five non-main components remain identical to stock. The SDK requires direct,
nonce-bound proof of the exact marker from both temples before enabling private
operations. Host tests execute the transformed lifecycle bodies under ASan/UBSan.

230.12 hardware result (2026-09-23): native bilateral OTA and direct identity
passed, but the LC3 array still produces noise/clipping and corrupts stock audio
until a Case reset. Starting RIGHT earlier is **not a validated fix**. Retain
this candidate for reproducibility; do not promote it as microphone-qualified.


### Codec service observation candidate (230.13)

Add `--port-codec-observation` after `--port-codec-prewarm` to build the separate
`codec-observation-experimental` artifact. Two guarded stock-worker BL sites call
wrappers that preserve the original DMIC-open and I2S-output service behavior and
record their signed returns, call counts and firmware uptime. They neither
allocate nor notify in the codec worker. A28-byteCA/v1 packet accompanies later
microphone status notifications. Count0means unobserved; result0without a count
is not success. These are service returns, not raw codec ACK payloads.

Context magic is0xC0FFEE79 and size0x3a4. The old context is not reused. Source
ASan/UBSan and emitted-Thumb emulation verify return/argument/register/stack
preservation, stale/missing context handling and packet bounds. The build recipe
pins both BL sites and service bodies; the whole stock image remains hash-pinned.
Startup order, calls and calibration delay remain230.12 behavior, with the small
execution cost of storing observations after a service returns.

BundleSHA256:`527336e6c91158148f1c44be498895abcdf66ed8604de896e576e04f9517fbf9`.
Size4593015; main3813772bytes,CRC32C8df5a666,
SHA256`170d2c33acdb550f881572b1eed68c503fc7aff9f558c996b5fb41c0239e8afa`.
All container checks pass and the five non-main components equal230.12. This
candidate is not microphone-qualified and is not an acoustic fix. Native import,
exact identity/capability gates and all six component pins passed five integration
tests. The webflasher includes the exact local-only package with unvalidated
hardware status; all 421 tests passed with real candidate fixtures. Physical
transfer and acoustic observations are tracked in the hardware validation ledger.


230.13 physical result (2026-09-23): native bilateral OTA, reboot and fresh
nonce-bound identities passed. RIGHT reported DMIC-open and I2S-output success
(result0, count1 each), but the array still produced sustained high-amplitude PCM
and STOP left stock capture noisy. Case B0 recovery restored quiet stock capture
and complete control-phrase recognition. These observations narrow the fault;
they do not qualify the microphone port or this payload's Case-USB transfer.


## 2026-09-23: 230.14 I2S observation candidate integrated, hardware qualification pending

The user’s 2.2.10.72 lineage remains the port reference. Stock I2S execution tests
show why relocating addresses alone is insufficient: a duplicate low-level open
returns 7 without publishing the output handle, while the caller still sets its
initialization flag. This is an offline failure-path demonstration, not yet the
cause of the observed physical array noise.

230.14 adds a read-only CI/v1 SRAM snapshot alongside CA/v1: raw initialized and
powered bytes, shared handle at `0x20077844`, fixed driver word at `0x20073aa0`,
and uptime. It never dereferences the observed handle or changes initialization.
The ABI review pins both the stock image and the relevant initializer/opener
instructions and literals. Context layout and microphone startup stay as in 230.13.

Candidate SHA-256 `1d45f689eb7d39e5e4fec733bd30966a2659b00e906fc2814d6e22061fcc2c75`,
4,593,235 bytes; main SHA-256
`217756cc297ff677156a6ca04aa1e964bdf26c20df3ae298e988b29e7d4582af`,
3,813,992 bytes, CRC32C `fb9a625b`. All five non-main components match both 230.13
and stock byte-for-byte. Full pins are in
`artifacts/cfw-2.3.0.24/i2s-observation-package-pins.json`.

Native SDK recognizes exact marker 230.14 while keeping the experimental audio
opt-in. CI parsing requires exact size/version/physical side/reserved bytes;
raw flags remain raw evidence. CI and CA headers are consumed before speech
routing even when malformed. The Debug importer pins the complete new bundle;
webflasher retains earlier candidates and adds a separate local-only 230.14 pin.
No public or hardware-qualified status was granted.

Validation: two C-source observation tests, four firmware guard tests, 37 Swift
transactions through the actual pinned two-lens C transport (including CI parser
checks in the Swift harness), and 420 web tests passed; three optional older-image
fixtures skipped. The new real package fixture executed and passed. The Catalyst
build is pending, and neither installation nor 230.14 hardware qualification has
occurred. Existing 230.13 app observation: Stage Ready, G2/R1 100% Ready, stock mic
listening. These UI indicators are not acoustic qualification.

## Combined revision-27 and buzzer candidate 230.18

`build_revision27_buzzer.py` combines the verified 230.16 source with the pinned
230.17 buzzer implementation in an independent source tree. It also serializes
buzzer callbacks with command cancellation using the image mutex, without waiting
on the timer thread, and checks deadlines before consuming a queued step.

From the repository root:

```sh
python3 firmware/cfw/g2-2.3.0.24/build_revision27_port.py
python3 firmware/cfw/g2-2.3.0.24/build_revision27_buzzer.py
```

The first command is only needed when the exact reviewed 230.16 source/package
is absent. The combined builder verifies all parent source hashes, the pinned
buzzer source, ARM context offsets, stock donor, generated package and unchanged
non-main components. It then executes six regression methods covering the actual
source and emitted Thumb code. Outputs go under
`artifacts/cfw-2.3.0.24/revision27-buzzer/`. No command installs or flashes firmware.

The independently reproduced 4,619,535-byte image has SHA256
`01d5e44cdf0802cf4d87639c079ddb05280d2b82f44d48dc3c1374e15f60a7ab`.
Its context is 0x554 bytes with magic 0xc0ffee81. SDK capability and Catalyst build
checks pass; local firmware-import pins remain unchanged. Hardware display,
buzzer timing under load, audio, and update/recovery qualification remain open.
See `docs/bluetooth/g2-230-hardware-validation.md` for dated evidence and limits.

## Revision-29 retained-root source review

`port_revision29_draw.py` applies the Faceclaw/29 CLEAR, full-root and animated
RECT_COPY grammar to the resolved `SybilSight/230.21` C tree. It keeps a
compile guard and `SybilSight/230.22-REVIEW` marker: the result is source for
review, not an update package. The 2026-09-24 follow-up ports g2flash's aligned
`memset` for full-frame clears. The new routine is placed after all existing
hook functions in the injected translation unit, preserving their addresses.

`audit_revision29_emitted.py --output /tmp/revision29-audit.json` temporarily
cross-compiles and replays the exact stock 2.3.0.24 patch, then deletes the
image and recipe. The latest audit found 47 unchanged patch sites, only six
size/checksum metadata changes outside the appended payload, and a hypothetical
4,616,951-byte image (SHA-256
`1958314652e6000a7b851d0fea301b7df1203db2a7e0bac10e5a0d1f99424e02`).
Six focused source, sanitizer, wire and replay tests pass. This does not
qualify installation, stereo output, update/recovery or microphone acoustics.

## 230.22 same-callback PCM state diagnostic

`build_revision27_pcm_state.py` pins the stock donor and exact 230.21 parent
source/package, then adds RA/v3 records to the existing sparse pre-LC3 probe.
Each record retains the RA/v2 per-lane levels and counts and snapshots the stock
audio-manager slot mask, I2S-initialized, codec-powered and codec-on flags, and
DMA frame count **inside the same PCM callback**. It sends no audio samples and
does not change codec startup, relay payloads or automatic microphone policy.

The offline image is `SybilSight/230.22`, SHA-256
`10f047dab6fe551e29cfe885bf279da5e564331bcd8205a000a376f84bfc79b8`
(4,616,923 bytes). The main component is 3,837,680 bytes, CRC32C `8eff86d3`;
the other five components remain stock-identical. The source sanitizer test
executes the probe with mocked hardware state and confirms unchanged audio
packets; the recipe retains all 47 stock patch anchors. It is an experimental
diagnostic, not a four-microphone fix or acoustically qualified CFW. The app
requires an explicit diagnostic opt-in to arm this image's array.

## 230.27 revision-35 display (g2flash Faceclaw/32–35), hardware qualification pending

`build_revision35_display.py` pins the exact 230.26 source and package (image SHA-256
`8784efd8…74b0ba`, recipe `70ba8bdd…a345089`), the stock donor and g2flash `9079f99`,
then applies `port_revision35_draw.py`. Every parent file is hash-pinned before any
write. All four upstream display changes are ported:

- `0aec4b9` (Faceclaw/32): message 30 `[30][1][level 2…100][visible 0/1][duration u16 ≤ 3000]`.
  The display task runs a smoothstep fade through the calibrated stock brightness
  sequence while the framebuffer lease is held. A wake waits for the next PRESENT.
  Lease release and cleanup hand brightness back to stock.
- `62703ab` (Faceclaw/33): REMAP_COLORS takes two 8-byte LUTs chosen by the destination
  pixel's x+y parity (dithered darken). The one-LUT revision-29 payload is now rejected.
- `d766df3` (Faceclaw/34): brightness is written only when the output level changes.
- `9079f99` (Faceclaw/35): draw-call flag 4 carries a clip rect `[x s16][y s16][w u16][h u16]`.
  It moves with the depth shift, intersects inherited clips and resets on a resource
  target. IMAGE/TEXT x/y become extended integers or expressions.

`display_list.c`, `texture_draw.c` and `brightness.{c,h}` are upstream's exact
`9079f99` files. Our 230.26 `texture_draw.c` was byte-identical to `e13842d`. The one
exception: CLEAR keeps 230.26's NULL-target rejection. Nothing was excluded. Buzzer,
microphone, identity and retained-scene code are untouched.

SybilSight adaptations:

- The brightness state is appended after every SybilSight context field, so all
  pinned offsets are unchanged. The context grows from 0x590 to 0x5b0 bytes, and its
  magic changes from 0xC0FFEE82 to 0xC0FFEE83. The static layout check asserts both.
- `brightness.c` is included last, after `revision29_memset.c`.
- Our dirty-row `display_copy_hook` forgets the framebuffer identity on a frozen or
  blanked brightness frame. The next frame is therefore copied in full.
- The ABI inventory takes upstream's brightness literals, 4 dependencies and 6 guards.
- Owner request: the dashboard phone-link line is drawn at the same coordinate on both
  lenses (`top = y+250`, centred in the cleared rows `y+236…y+288`), with no `L `/`R `
  tag, so it fuses binocularly. Differing per-lens strings (for example different
  privacy addresses, or a one-sided link) now overlap. The same edit is uncommitted in
  `~/Repo/g2flash-amguru`. `port_dashboard.py` now reads that repository's pinned
  `6f2cea3` blob, so builds up to 230.26 still reproduce.

Package `artifacts/cfw-2.3.0.24/revision35-display/g2-2.3.0.24-revision35-display-experimental.bin`:

- SHA-256 `36cc6222227275d0fd07f134c765737e508b5e205e6d6aa1122a4b2cf1996bfa`,
  4,624,175 bytes, MD5 `e96594ca8675cbee252a29f4150079cf`.
- Recipe SHA-256 `cb28b35a9b5ad2227285d174dc9934098e019ddfb823b6cd0a2fb05f2ecda237`,
  49 patches.
- Main payload 3,844,932 bytes, CRC32C `14782e55`, SHA-256
  `088d94f31c1d08d4f84dd119b4bb833ee28dbad1f66a535e7ab9c3dee621fdc8`.
- The other five components are identical to stock and to 230.26.
- `audit_revision35_emitted.py` found all 49 patch sites with unchanged offsets, stock
  bytes and descriptions, and one append at the same offset (79,652 → 86,212 bytes).
  The six size/checksum records changed. Each of the 36 retargeted hook branches or
  pointers still lands inside the injected payload.
- `test_revision35_draw.py` compiles the transformed C under ASan/UBSan. It covers clip
  bounds at the int16/uint16 extremes, depth and nested clips, dithered remap parity
  and payload lengths, extended IMAGE/TEXT coordinates, far-off values, truncation,
  brightness bounds and malformed messages, fade/wake/sleep, the flicker fix, release,
  the full copy after a frozen frame, and the shared dashboard lane.

```sh
python3 firmware/cfw/g2-2.3.0.24/build_revision35_display.py
python3 -m unittest -v firmware/cfw/g2-2.3.0.24/test_revision35_draw.py
```

The SDK registry row is `sybilSight(27, displayLists: 35, buzzerSequencer: 2, i2s: 2)`.
Its status is experimental. The webflasher stages it as `g2-custom-2.3.0.24-230.27` with
trust `experimental-local`, so it is never a default. No firmware was flashed, and
hardware qualification of the display, brightness, update and recovery is pending.

## Display performance source port (unpublished)

The display performance work is implemented in
`display-performance/{performance.h,compose.inc,alpha.inc,adapter.inc}` and applied
by `port_display_performance.py`. This is **not a 230.86 release**. No new firmware
marker, capability registry entry, webflasher asset, or installable image is supplied.
The complete 230.84 main source has been recovered into `parent-230.84/source`
and hash-pinned in `parent-230.84/receipt.json`. Compiling those sources reproduces
its main payload byte for byte. Preserving the authenticated archive's codec
(which is separately compiled) reproduces the full 230.84 image exactly. The
230.85 keyboard extension then reproduces its archived image exactly; all seven
keyboard emulation, sanitizer, replay and ABI checks pass. The keyboard remains an
additive extension, not a C file inside the parent renderer tree.

Reproduce the parent with Python plus `capstone`, and an ARM-capable clang:

```sh
python3 firmware/cfw/g2-2.3.0.24/rebuild_verified_parent.py \
  --stock /path/to/stock-2.3.0.24.bin \
  --parent /path/to/g2-2.3.0.24-sybilsight-230.84.bin \
  --output /path/to/reconstructed-230.84.bin
```

The script verifies all 77 source hashes, stock and parent hashes, recompiles in
an isolated temporary directory, compares each component, and requires exact
whole-image equality. `source/patches/cfw_patches.json` is the historical upstream
reference recipe; use the generated recipe for this source snapshot. The missing
legacy dashboard donor was recovered from the original GitHub fork network at
commit `6f2cea3878f391427af3e5f8c95fe1f295bd8831` and matches its historical hash.

Implemented paths:

- Host compositor snapshots defer rasterization, grayscale conversion, and PNG
  encoding until a consumer needs them. Direct sends avoid PNG/base64 round trips;
  mirror previews and animated transitions retain lazy PNG access.
- Queued replacements coalesce before layout processing and rasterization, by owner
  and geometry. Clears, animations, and explicit transitions preserve ordering.
  Scene updates retain app layer order and reject older epochs.
- Existing retained scenes permit occluded lower text and restore higher opaque
  images. Experimental opcode 10 adds separate 4-bit luminance/coverage resources
  for text alpha compositing. Legacy contracts reject it. Host alpha scenes remain
  explicitly disabled until a matching firmware contract is admitted.
- Timer callbacks only publish an atomic mailbox and enqueue a display task. The
  display worker performs validation, rendering, and damage comparison under the
  existing image mutex. Queue failure retries; expired leases stop animation.
- Immutable display-list preflight results are reused until resource generation
  changes. Expressions and resource writes prevent reuse. Damage includes pixels
  erased by moving objects and falls back to full copy when identity is uncertain.
- Telemetry separates enqueue, raster, copy/flush consumption and copied bytes.
  Consumption is **not SPI DMA completion or optical presentation**. The upstream
  reference fixture copies a full panel, and its byte telemetry reports that fact;
  the SybilSight parent already supplies its dirty-row copy hook.
- Mode 60 v1 supplies bounded, versioned object bindings, ordered SHOW, epochs,
  targeted missing-object repair, and consumption reports. Resources are resolved
  by ID rather than retained pointers. SDK desired state survives invalidation;
  residency requires matching application replies from both lenses. Distinct
  request IDs, bounded CRC-checked fragment assembly, and generation checks reject
  stale or conflicting replies. Binding replay requires the referenced resource
  bytes to be uploaded first; automatic restoration of their complete dependency
  graph remains part of integration with the future firmware build. The SDK send
  path is gated on `performanceV1`, which
  no published registry entry currently advertises.

`port(source)` authenticates the complete recovered parent C tree, including
microphone, stock ABI inventory and existing dirty-row fields. The separately
compiled keyboard extension must still be retained when packaging a successor. It validates every transformation
anchor before writing source. `reference_only=True` is exclusively a test fixture
from pinned upstream revision 35 (`9079f994760d7b8f91eab1a0e8c4a8ebca9fd753`);
that tree must never replace the current microphone/keyboard parent.

Offline checks (no flashing):

```sh
python3 firmware/cfw/g2-2.3.0.24/test_display_performance.py -v
bash scripts/test_g2_private_transport.sh
```

The C tests run the transformed renderer and scheduler under ASan/UBSan, validate
malformed alpha inputs, resource capacity, stale epochs, lease/queue failure,
shared-walk budgets, rollback, damage and telemetry. They also compile the complete
reference and recovered production ARM blobs through the upstream mini-linker,
requiring all relocations to resolve. A regression check rejects altered parent
source hashes. The production port keeps panel watchdog callback address creation
in a nearby helper to avoid Thumb relocation range failures in the larger blob. These checks do not establish physical frame time, battery consumption,
DMA completion or firmware recovery. Reproducing the archived parent establishes
source provenance; a successor performance image still needs integration and
hardware qualification.
