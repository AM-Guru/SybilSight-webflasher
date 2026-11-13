# G2 wired firmware recovery goal

Goal: recover the original failed-update pair through the Smart Case's wired
interface, with identified stock images and verified post-install operation.
The goal remains active. No original-pair application-version reply or any SBL
STATUS has qualified in the current recovery campaign. No stock recovery image
was transferred through the wired interface.
The operator confirmed that BLE left `4FB39E`, serial `S211GBBC180304`, is the
secondary-control left temple and is not associated with the original failed
pair. On 2026-11-08 the operator inserted the fully discharged original pair
during the printed schema-14 receiver window. Fresh post-run stock telemetry
reported both contacts present, so that run is target-bound. The original pair
remains seated directly in the Case.

“All possible mechanisms” has no finite, provable boundary. This inventory
tracks distinct mechanisms supported by source or hardware evidence. A silent
probe does not eliminate a mechanism whose reset, electrical route or retail
configuration remains unknown. Each additional experiment must resolve a named
unknown; repeating an unchanged negative probe does not advance this inventory.

## Evidence and immediate next test

- After the 2026-11-09 USB reconnection with the original pair seated, fresh
  stock Case 1.2.57 telemetry identified the exact Case serial, detected both
  contacts, and reported inactive temple OTA. Fixed version queries to both
  routes timed out without a checksum-valid reply. The port closed and no
  firmware image or SRAM payload was sent. Audit:
  `work/usb-stock-recovery-20261104/goal/reconnected-primary-stock-version-20261109-v1/audit.json`.
  A subsequent insertion-window preflight still found the selected original
  left temple seated, so the secondary-control probe remains unstarted.

- The target-bound depleted-insertion schema-14 run armed left RX at 1 Mbaud
  before insertion, completed 12,000 pre-pulse and 3,000 post-pulse SysTick
  wraps, retained zero UART bytes, sent zero temple bytes, and restored the
  full stock Case image, mirrors and original 32 KiB SRAM snapshot. The
  operator confirmed insertion during the live window; fresh telemetry then
  reported `GLS_L:1`, `GLS_R:1`, stock 1.2.57 and inactive temple OTA. Both
  stock status routes timed out eight times. This binds the observation to the
  original pair but remains inconclusive silence: no physical Apollo reset or
  temple TX electrical activity was measured. Evidence:
  `work/usb-stock-recovery-20261104/goal/case-even-bootlog-capture-original-left-watchdog-headroom-hardware-v3/`.
- Repeating the same UART probe cannot resolve the remaining ambiguity. The
  next useful discriminator must measure an Apollo power/reset boundary or
  temple-side TX activity, then correlate it with an already qualified RX
  window. A writer remains prohibited until a CRC-valid original-target STATUS
  also establishes route, baud, endpoint identity, provisioning and capacity.

- Original pair, directly seated: four stock-derived PB9 reset/HELLO probes,
  both routes at 1 Mbaud and 115200. Each completed all 103 actions, sent 20
  HELLO requests, received zero bytes, and restored exact YHM/GPIO state and
  stock case 1.2.57. Normal application-version queries were unanswered before
  and after. See `work/usb-stock-recovery-20261104/reset-hardware-original/`.
- Physical Apollo reset, analog pulse widths, battery state and retail recovery
  configuration remain unmeasured. Presence bits establish contact detection,
  not processor health or a reset class.
- The secondary pair's left temple previously answered with 2.2.6.10/HW5 and
  was later identified as BLE left `4FB39E`, serial `S211GBBC180304`. The
  exact recovery-experiment main was transferred to it with 935/935 block ACKs
  and END status 8, but post-reboot application advertisement has not been
  observed. That transfer is evidence only about the secondary control.
- A new `scripts/case_uart_version_control/` payload tests the same native UART
  direction helpers and polled register path as the SBL probe. It sends one
  fixed application version query, with no temple reset or image-write command.

### Framing correction verified against native stock code

USB case packets and pogo requests are different layers. USB
`5a a5 7f 04 24 00 00 00 a6` becomes pogo body `24 00 00 00 a6`.
The right body is `24 00 01 00 a7`. The temple's `comm_read_539e92` checks
`(length + 0x7d + sum(bytes except checksum)) & 0xff` before dispatch.
The response still has `5a a5 ff` framing.

The actual stock 2.2.6.10 receiver was executed under Unicorn: both five-byte
bodies were accepted, both nine-byte USB frames and a corrupt body were
rejected. A sixth case confirmed the checksum bypass for a `T` prefix.
This does **not** make `T` a debug-shell escape: the product dispatcher maps
byte `0x54` to the application OTA-file handler. Do not send guessed text
commands as a supposed bootloader entry sequence.

Native test source and result:
`evenRealities-openCFW/build/wired-recovery-goal/check_native_pogo_request.py`
and `native-pogo-framing.json`. Neither opens hardware. The temporary draft
control that used nine bytes was corrected before any hardware execution.
The SBL HELLO probes use their independent eight-byte framing and are unaffected.

The initial nine-byte synthetic control run is superseded; its passing model
result did not establish the correct real-device request boundary. The corrected
five-byte report is
`g2-firmware-emulator/generated/recovery-control/correct-pogo-body/report.json`.

### Early RX and overrun detection

Native case UART execution confirms PB8/PB9 AF4 in both direction modes,
TX CR1=9, RX CR1=5, and CR3=0x1000 (OVRDIS). The prototype now clears and
verifies OVRDIS with UE disabled. Its early mode sets UE|TE|RE before TX,
waits for TEACK/REACK, polls during transmit, and preserves RE through the
turnaround. No receive flush or native reinitialization occurs after TX.

The schema-5 version-control variants passed 110 compiled fault cases, 18 timed
scenarios and two Renode exchanges. The left early-mode live test captured
exactly `24 00 00 00 a6`, no version frame. Readiness, overrun configuration,
exact YHM/GPIO restoration, retained clearing and stock 1.2.57 verified. This
is echo-compatible evidence, not a positive temple control. Audit:
`work/usb-stock-recovery-20261104/goal/early-rx-hardware-20261105T032008Z/`.

The separate schema-6 `scripts/case_early_sbl_probe/` sends only eight-byte
HELLO, with no temple reset or writer. RX remains enabled between its 20
requests. Four route/baud variants passed 112 compiled fault cases; 14 timed
scenarios included two Renode exchanges, echo without an endpoint, immediate
STATUS, delayed STATUS across requests and deliberate overrun. A synthetic
listener explicitly assumes prior entry; neither READY nor echo creates it.
Native external-watchdog service between requests is a CPU polling gap, with
any detected overrun failing the result.

Its live probes on both routes at 1 Mbaud and 115200 each sent 160 bytes and
counted 160 RX bytes. The retained final 128 bytes equal repeated HELLO, with
no STATUS. The first 32 RX bytes were not retained, so their contents cannot
be asserted. All four verified exact cleanup, retained clearing and stock
restore. A first 115200 attempt stopped during case-code readback on a missing
USB resynchronization ACK, before SRAM upload/launch; stock restore verified.
The fresh 115200 retry completed on both routes. See
`work/usb-stock-recovery-20261104/goal/early-sbl-hardware-summary.json`. These steady-state no-reset tests
do not establish the presence/absence of an early boot window or retail ROM
provisioning. No new reset pulse train was used for these tests.

### Reset plus early RX (schema 7)

The separate `scripts/case_sbl_reset_early/` preserves the historical stock_reset
source function and every extracted native action. Four route/baud builds pass
31 compiled fault cases each (124 total). Its final timed report is
`g2-firmware-emulator/generated/recovery-reset-early/final-run/report.json`:
31 scenarios passed, including two Renode exchanges. The early receive fixture
captures the response lost in the old native-turnaround fixture; window expiry
during the train or native post-train TX setup remains possible.

This variant does not receive during the reset train. It calls native UART TX
setup once after release, checks CR3 overrun configuration with UE off, waits
for TEACK/REACK, and keeps RE enabled through all subsequent HELLOs. CPU polling
gaps during watchdog service remain; detected errors reject the result.
The final host additionally re-extracts the exact native trace from the stock
reference before USB access. A pre-hardware test caught tuple/list JSON
normalization; it was corrected before live execution.

The four schema-7 hardware variants also completed on the unconfirmed current
pair: each recorded 103 actions/62 delay ticks, 20 HELLOs, 160 TX and 160 RX
bytes, no UART error, no STATUS, and a retained 128-byte tail equal to HELLO
repetitions. The first 32 RX bytes per variant were not retained. All verified
exact cleanup, retained clearing and stock 1.2.57 restoration. Evidence:
`work/usb-stock-recovery-20261104/goal/reset-early-hardware-20261105T034727Z/verified-hardware-summary.json`.
No physical Apollo reset/class or retail recovery policy is established.

### Prepared UART and case counter bound (schema 8)

`scripts/case_sbl_reset_prepared/` moves native UART setup before the train.
Afterward it restores captured pin fields directly, verifies framing/divisor,
waits for receive readiness and retains RX through HELLO. A SysTick HCLK
counter starts before programmed pin release and is sampled after the first
TDR write. Enabled clock selection, no wrap, a nonzero interval at most64,000
cycles and consistent start/end/difference are required. This measures case
software sequencing, not analog pad levels, complete HELLO arrival or Apollo
reset. Timer failures may stop after the first fixed HELLO byte.

Four builds passed148 compiled fault cases;32 timed scenarios included2 Renode
exchanges. The focused webflasher suite passed78 tests and emulator suite93.
Report: `g2-firmware-emulator/generated/recovery-reset-prepared/initial-run/report.json`.

All four live variants completed: left/right at1Mbaud and115200. Their recorded
cycle bounds were348,353,352,357 respectively (5.4375–5.578125microseconds at
checked nominal64MHz). Each sent20 HELLOs/160bytes, counted160RXbytes, retained
a128-byte tail matching HELLO repetitions, and found no STATUS. First32RXbytes
were not retained. Every run verified exact cleanup, retained clearing and
stock1.2.57 restoration. No case-flash or glasses-image write occurred.
Evidence: `work/usb-stock-recovery-20261104/goal/PREPARED-UART-RESULT.md` and
`reset-prepared-hardware-summary.json` beside it.

A fresh read-only BLE scan/probe found left4FB39E, serialS211GBBC180304, reporting
2.2.6.10 through Device Information. This establishes limited GATT liveness,
not a healthy full application, installed artifact identity or a working pogo
path. Pair binding is pending operator response. A corrected20-second BLE
observation spans the left115200 trial with no reported disconnect; it cannot
identify Apollo reset/class. An earlier observation hit its configured15-second
overall deadline and supplies no reset evidence. See `ble-observation-evidence.json`.

Native disassembly confirms two calls to the stock pulse function0x0800B678
from the no-reply reset task at0x08009AFA/0x08009B10. Its osDelay wrapper at
0x0800A7B0 rejects interrupt context and calls the RTOS for nonzero delays.
The current SRAM action replay reproduces native ordering/arguments, not the
original pulse function instruction path or measured pulse widths. Directly
calling that function from interrupts-disabled SRAM startup would be invalid.
A native-task-context case hook is the next source-supported experiment; its
image/ABI, route, scheduler, storage layout, page backup and stock restoration
must be concrete and qualified before a case-flash change. No such image has
been built or flashed yet. See `native-task-reset-audit.json` in the goal folder.

### Shared protocol and pin-role evidence

A fresh read of local AmbiqSuite 5.2.0 confirms that both ordinary wired update
and MRAM recovery use HELLO and 96-byte STATUS. MRAM `send_hello` interprets the
low 16 bits of the word at byte 8 as a recovery type (vendor constants 58 and
276); the ordinary host interprets that word as an SBL version. A CRC-valid
frame alone must not select an image format or authorize a write. Preserve the
raw reply and establish the responding stage, identity and effective policy.

The original 2.2.6.10 ROM pin table at `0x00786070` is `{42,44,4,4}`. Upstream
`am_hal_pin.h` names GPIO42 mux4 UART2TX and GPIO44 mux4 UART2RX. The current
reconstructed board_data.c field names call the first slot rx_pin and second
tx_pin; those names alone cannot establish physical direction. No C source was
changed. Case PB8/PB9-to-Apollo coupling and boot-strap reachability remain
unmeasured; do not infer a recovery pin from matching UART names.
Evidence: `work/usb-stock-recovery-20261104/goal/sdk-protocol-and-pins-audit.json`.

Historical `work/apollo510-vendor-recovery-audit/mac-fullwindow-*.json` also
record two 800,000-ms/2,000-HELLO runs, zero RX and restored stock operation.
They use the historical native-turnaround path and do not bind the currently
seated pair. They are not evidence of a measured 800-second retail ROM window,
and they do not justify an unchanged repeated long poll now.

## Mechanism inventory

| ID | Mechanism | Current evidence/status | Next discriminating test or requirement |
|---|---|---|---|
| W01 | Running application's wired OTA receiver | Product commands `0x52..0x55` dispatch to the application OTA service. Original pair does not answer version queries, as expected after its failed application flash. | If original application communication returns, validate identity and the normal wired OTA dry run before transfer. More version-only retries cannot diagnose the bootloader. |
| W02 | Stock case reset followed immediately by SBL HELLO | Early-armed probes capture HELLO-compatible echo. Eighteen original-pair PB9 waveform runs across both routes and two bauds completed with no valid SBL STATUS; all restored stock Case 1.2.57. Apollo reset delivery remains unverified. | Measure the actual Apollo reset and temple TX electrical path or identify a distinct wired entry primitive. No unchanged waveform repeat is scheduled. |
| W03 | True cold insertion with an early listening window | On 2026-11-08 the fully discharged original pair was operator-inserted during the live schema-14 left 1-Mbaud RX-only window. The target-bound probe retained zero bytes, restored stock, and fresh telemetry found both contacts present with both application-status routes timing out. | Measure a real Apollo power/reset boundary and temple TX electrical activity, then correlate it with bilateral capture. The zero-byte left result is inconclusive and does not justify an unchanged repeat. |
| W04 | Ordinary SBL GPIO boot override | INFOC `BOOT_OVERRIDE` has enable/pin/polarity fields. PB8/PB9 weak-pull candidate prototypes exist; actual retail override and coupling remain unknown. | Read device-bound effective provisioning, or acquire a qualified physical boot/reset observation. Hold only the identified override across the identified reset. |
| W05 | Application-initiated MRAM recovery through OTAPOINTER | OpenCFW's exact experiment writes `0xAFD1363A` before RAM initialization on B1+ and leaves it armed until a Case response. Its Apollo main was transferred only to secondary-control left `4FB39E` with 935/935 block ACKs and END `UPDATING`; installation/boot remains unverified, and it was never installed on the original pair. The 2026-11-11 schema-12 timed secondary insertion run was not target-bound: postflight showed an empty Case. Later seated bilateral software-reset/version checks and all four route/baud early-SBL probes found no application version or valid STATUS, including a read-only recheck after about 18 minutes on charge. | The empty-Case right-115200 control and original-target seated probes are complete. A future valid STATUS would prove an entry path; current silence does not prove no recovery configuration. |
| W06 | MRAM-recovery GPIO trigger | Separate INFO0 MRAM control pin/polarity, master enable and wired enable, distinct from W04. Retail values unknown. | Decode effective device configuration and identify electrical access to that particular pin. Simulate configuration and timing hypotheses before hardware. |
| W07 | Automatic recovery after authentication/corruption detection | Vendor SBL can enter wired update on a boot error if provisioned. The Even bootloader at `0x410000` is the image it first runs; a failed write confined to the later Even main at `0x438000` need not create an SBL boot error. The failed component on this original pair is unknown. | Obtain a device-bound SBL status or the original failed-update component log. Do not intentionally corrupt the Even bootloader to manufacture a trigger. |
| W08 | MRAM recovery from external NV assets | Separate recovery metadata and asset layout; Even's staged LittleFS OTA file is not evidence of configured MRAM recovery assets. | Establish retail metadata/configuration and authentic assets; distinguish autonomous restore from host UART restore. |
| W09 | Even bootloader staged-file installer | Reconstructed manager checks `0x007FE000 == 0x55555555`; installer uses `ota/s200_firmware_ota.bin`. Traced paths do not expose a wired image receiver. | Verify whether a staged image/flag already exists through a responding endpoint. No remote flag-setting path has been established with the app down. |
| W10 | Factory/product-test or text-command entry | Product dispatcher and UART manager are application services. `T` maps to OTA data handling, not a standalone ROM shell. No generic CPU-register reader identified in the traced product handlers. Command `0x0B` is a fixed application-level reset: after an acknowledgement, its deferred handler calls the system reset wrapper. A hash-pinned reset-only Case bridge and Thumb-emulated validator passed offline tests. The 2026-11-11 secondary and original seated tests each handed one exact request to both Case relay routes, but neither pair returned an application acknowledgement; stock Case 1.2.57 and both contacts were confirmed afterward. | The original pair also received one relay attempt per route with no acknowledgement. A timeout does not prove execution. This path needs a running application dispatcher or a distinct entry primitive. |
| W11 | Stock console restart commands / rapid USB gesture | Traced console/event paths call the same glasses-reset helper. Their existence does not add an SBL override or arming primitive. | Audit any genuinely different command path before treating it as a new hardware mechanism. |
| W12 | Debug shell, SWD or alternate physical interface | Shell uses logical UART channel 1, box manager channel 2. The stock pogo UART row is Apollo GPIO42/44, while Apollo510B SWD clock/data are GPIO20/21; software remuxing the mapped contact pair cannot make it ordinary SWD. | A different physical route or device-bound debug policy would be needed. Do not treat the two pogo contacts as SWD pins. |
| W13 | PMIC hardware reset, ship/wake or watchdog | nPM1300 and BQ25180 component reset routes exist; no pogo connection to their reset inputs or direct PMIC bus established. Exact stock 2.2.6.10 favors family 1; current retail identity/registers unknown. Native BQ defaults preserve SHIP_RST and timer upper fields (262 fixtures), rather than select a hardware reset. | Identify physical PMIC/reset wiring and observed reset class. Do not mistake ship configuration, case VBUS switching or register-default watchdog recovery for an Apollo reset. |
| W14 | Apollo510 ordinary wired stock transfer through schema-13 | Exact AmbiqSuite 5.2.0 framing, stock image envelope, 997-byte Case chunks, one-shot ACK policy, dual 115200/1000000 bridge artifacts and postflight runner are offline-qualified. The 2.4.0.24 bundle was fetched from two Even CDNs, found byte-identical, extracted, hash-pinned, and built for both bauds. No schema-13 bridge has run on hardware and no stock byte has been sent. | Require a separate CRC-valid STATUS from the original target, bind route/baud/full frame, and require `maxStorage >= 3699636` for 2.4.0.24. Use the matching hash-pinned bridge and verify the version mapped to its exact image digest. A single-temple liveness reply is reported only as target responsive; pair recovery needs bilateral stock boot verification. |
| W15 | Community patched Even bootloader UART2 RAM loader | `drdaeman/g2-bootloader-patch` at `6198d70` was built with LLVM 21; its three pinned binaries reproduced and 120 local tests passed. The original Case's live YHM baseline required an exact five-byte profile adaptation before its relay could arm. Both original-pair routes then armed UART2 and returned checksum-valid Case bridge status 6 before any framed HELO beacon. No patch handshake or RAM program ran. | This loader must have been installed earlier by a responsive stock application over BLE. No G2 advertised in the fresh scan. To distinguish an absent patch from an unproven Apollo reset/UART path, obtain an instrumented patched positive control or physical reset/TX evidence; do not infer patch absence from Case-only silence. |
| W16 | Stock Case output-disable window while glasses remain seated | The Case accepted destination-2 `0x3F` output-disable and output-enable commands. Native code ties the flag to YHM register 3/4 selection. A later stock `DEAA` in-place hardware readback measured `AF/AF` before, `AE/AE` with the flag off, then `AF/AF` restored. YHM register 1 concurrently changed `0x11 → 0x00 → 0x11`. Two BLE scans during the earlier 35-second window saw no G2, and subsequent wired versions timed out. | Measure calibrated pogo voltage or a physical Apollo reset; YHM register changes establish a Case control transition but do not prove a cold boot or bootloader entry. |
| W17 | Stock Case glasses-OTA route selection | Destination-2 `0x56` entered and exited left and right OTA modes with the original pair seated. Fixed version queries in each mode returned no temple frame; ordinary version queries afterward timed out bilaterally. The Case returned to stock 1.2.57 with `otaGls:0` and both contacts. | A distinct receiver or measured hardware reset is required; repeating this same OTA-mode transition adds no new evidence. |
| W18 | Output-off reset then software output-on while seated | Stock `0x3F` set both live YHM output registers to `AE`; stock `DEB0` confirmed a reset command while they remained `AE`; stock `0x3F` returned them to `AF`. Bilateral application versions still timed out. | This sequence proves Case control and command order, not delivered pogo voltage or Apollo reset. An unchanged repeat adds no discriminator. |
| W19 | Custom Case receiver across an in-place YHM output edge | Schema-16 temporary Case firmware armed left and right UART RX and raw PB9 sampling with both temples seated, called the stock YHM setter `AE → AF → AE`, and retained the first bytes through 15,000 SysTick wraps. Both routes completed and saw static high PB9, one invalid `0x00` with UART errors, and no bootloader marker; exact Case flash/SRAM and stock output were restored. | A measured Apollo power/reset boundary or retail INFO0/INFOC provisioning remains needed to establish that the temple entered an SBL listening state. |
| W20 | Native Case reset while selected YHM output is off, then output-on with early UART/PB9 capture | A separate compiled hook armed RX, held the selected output at `AE`, called the stock reset primitive after 3,000 SysTick wraps, set `AF`, and captured for 12,000 more wraps. Both original routes completed with static high PB9, an error-marked `00`, no bootloader marker, and exact stock Case restoration. Read-only versions still timed out. | A bounded SBL HELLO in this exact window or device-bound INFO0/INFOC and measured Apollo reset is required. Passive silence does not exclude an unprompted SBL listener. |
| W21 | Native Case off-state reset, then output-on with fixed SBL HELLO in the early receive window | Schema-17 hook sent 20 exact Ambiq HELLO frames per original route after the native reset and retained one error-marked `00` plus 20 byte-exact HELLO copies each. No CRC-valid STATUS or Even bootloader marker appeared. The left transaction restored stock; the right first restore failed a writer result check, then restore-only verified exact original Case flash, mirrors, SRAM, stock 1.2.57 and output. | PB9 activity proves Case receive-pin activity; the source of the HELLO copies is unassigned. Establish device-bound INFO0/INFOC and reset delivery or a distinct authenticated SBL response before any writer. |
| W22 | Same seated off-state reset and fixed SBL HELLO at 115200 baud | A separate schema-18 build set Case UART BRR 556 and sent the same 20 fixed HELLOs per original route. Both retained an error-marked `00` followed by byte-exact HELLO copies, with no CRC-valid STATUS. The guarded runner verified exact Case pages, mirrors, SRAM, stock 1.2.57 and output on both routes; bilateral stock version queries still timed out. An empty-Case control also retained exact HELLO copies. | The seated copies do not establish temple receipt, Apollo reset or retail SBL entry; require physical reset/receipt and device-bound provisioning evidence before another UART probe. |
| W23 | Stock Even bootloader UART2 direct recovery ingress | All 18 local stock components initialize UART2 for GPIO42/44 at 1 Mbaud with zero receive callback. In 2.4.0.24, the post-bringup routine powers the row down, and main startup powers on UART1 only. | The analyzed stock startup has no evidenced UART2 recovery receiver. A target-bound original bootloader readback, dynamic activation evidence, or a genuinely distinct ingress is needed to reopen this path. |

### W09 bootloader UART receive boundary

The reconstructed Even bootloader contains generic UART1/2/3 IRQ wrappers and
`opencfw_boot_uart_irq_rx_drain` at stock `0x0041F776`. That drain reads at most
15 or 16 FIFO bytes, then checks the platform row's callback pointer at
`row + 0x14`; when it is zero, it clears the staged byte count without
dispatching a consumer. The recovered scatter-initialized four-row table at
`0x20000454` sets this callback word to zero in each populated UART row.
The reconstructed manager and DFU service instead read their staged LittleFS
image. See `evenRealities-openCFW/g2/src/apollo-bootloader/{startup/initialized_data.c,initializer-callbacks/uart_irq_rx.c}` and
`g2/docs/reference/bootloader-recovery-path.md`.

This accounts for the presence of UART RX interrupt machinery without
identifying a pogo firmware receiver. The source reconstruction and a search
for recovered setters are not a complete runtime write trace, so this remains
an evidence boundary rather than a proof that no hidden bootloader receiver
can exist. A real receive callback, command parser and route binding would be
needed before treating the Even bootloader as a separate wired transfer path.

### Diagnostic discriminator D01: Even bootloader pogo log

This is an observability aid, not a fifteenth recovery mechanism. The
reconstructed Even bootloader's EasyLogger wrapper sends on UART row 1. That
row is configured for Apollo pins 42/44, function 4, at 1,000,000 baud. The
stock application uses the same pins and baud for `BOX_UART=2`, the Case pogo
link. The bootloader contains the exact strings `>>> Even Bootloader start <<<`,
`otaFlag = 0x%x`, `need updata firmware`, and
`DO NOT need updata firmware, GO TO APP`.

The schema-12 runner now classifies those exact strings in its already retained
128-byte raw receive window. This adds no query or firmware byte. An exact
marker would positively distinguish the Even bootloader/manager path from SBL
STATUS. No marker is inconclusive: the ring can overwrite earlier output, the
capture can begin after a banner, and the physical reset path remains
unverified. The source audit is
`work/usb-stock-recovery-20261104/goal/even-bootloader-pogo-log-route-audit.json`;
six synthetic retention/classification cases are in
`/Users/kalani/Repo/g2-firmware-emulator/work/even-bootlog-observer-v1/report.json`.

To reduce the overwrite limit without adding a query, schema 14 now provides a
separate passive prototype with first-byte-saturating 1,020-byte retention and
a 1-Mbaud RX-only path. Its 1,604-byte compiled hook has no UART transmit-
register path and reports zero temple bytes. Eleven static/parser cases and six
actual compiled-hook Unicorn cases pass with HAL tick deliberately frozen; all
six runtime cases record zero TX writes.
The exact build is
`work/usb-stock-recovery-20261104/goal/case-even-bootlog-capture-build-v10-watchdog-headroom`, and
the emulator cross-check is
`/Users/kalani/Repo/g2-firmware-emulator/work/case-even-bootlog-capture-v8-watchdog-headroom/report.json`.
An exact two-page patch/restore plan and its SRAM-resident page writer now also
exist at `work/usb-stock-recovery-20261104/goal/case-even-bootlog-capture-plan-v7-watchdog-headroom`
and `work/usb-stock-recovery-20261104/goal/case-even-bootlog-capture-writer-v7-watchdog-headroom`.
The writer passed 27 compiled-controller fixture cases, and an independent
inspector re-derives its payload, source pins, page header, plan pages and zero
temple-command capability.
The schema-14 path now also has a fail-closed SRAM stager, a read-only mode-2
staging-qualification command, and a transactional capture runner. The runner
requires a provenance-complete hardware staging audit before it can patch either
Case page, retains the full 1,280-byte result region, issues one stock reset with
no temple query, and uses the existing exact-page rollback transaction. Nine
focused schema-14 host tests cover configuration rejection, full evidence
clearing, marker retention, zero TX, artifact tampering and provenance-free
audit rejection.
The emulator uses explicit scheduler, pulse, tick and FIFO fixtures: it does not
prove electrical capture, the native pulse, Apollo reset, or bootloader
execution. The stager subsequently qualified both pages on hardware with zero
flash writes and exact SRAM restoration. Two empty-case controls and the
operator-confirmed original-target v3 run executed transactionally. V3 restored
the full stock code, mirrors, 32 KiB SRAM snapshot and stock 1.2.57; its
qualified left receiver retained zero bytes. Fresh `GLS_L:1`/`GLS_R:1`
telemetry binds the run to the original pair. Schema 14 remains D02 rather than
a recovery mechanism, and its missing marker remains inconclusive because
Apollo reset and temple electrical TX were not observed.

An arbitrary rail-glitch sweep has neither a defined circuit/reset model nor an
observable recovery acceptance condition here. It is not counted as a tested
recovery mechanism. A measured, specified PMIC/reset operation can be added to
the inventory if identified.

## Source anchors and proof limits

Paths below are in the adjacent `evenRealities-openCFW` checkout:

- `g2/src/case/startup/application_policy_no_reply_reset_candidate.c`,
  `application_policy_reset_pulse_candidate.c`, and
  `application_policy_ota_side_prepare_candidate.c`: case reset caller,
  waveform and routing. Their actual pinned stock waveform is extracted by
  `scripts/case_sbl_reset_capture/trace.py`.
- `g2/src/apollo-main/drivers/power/box-detect/box_uart_mgr.c`: request checksum,
  logical UART channel, task-dependent processing and response path.
- `g2/src/apollo-main/app/a-55-pt-protocol/pt_protocol_procsr.c` and
  `app/a-57-pt-protocol/pt_procsr_cmds.c`: command selection and wired OTA.
- `g2/src/apollo-main/system/self-recovery/self_recovery.c`: custom arming hook.
  Historical diagnosis documents refer to other builds/pairs and do not prove
  the installed code, a specific hang, or key state on the current original pair.
- `g2/src/apollo-bootloader/manager-task/manager_task.c` and
  `update-core/rom_resources.c`: Even installer flag and staged-image path.
- `third-party/upstream/ambiqhal-apollo510/mcu/apollo510/hal/mcu/am_hal_mram_recovery.c`
  and `regs/am_mcu_apollo510_mraminfo0.h`: arming API and control field geometry.

[Ambiq's MRAM recovery guide](https://contentportal.ambiq.com/documents/20123/4133620/Apollo5-MRAM-Recovery-Users-Guide.pdf)
describes a configured SBR/SBL recovery flow with distinct recovery assets and
a HELLO/STATUS subset. Wired images use a different format from ordinary update
images. A key does not by itself establish enabled recovery or image acceptance.
[ERR034](https://contentportal.ambiq.com/documents/20123/4133620/Apollo510-Errata-List_v2p0.pdf)
documents an older-SBL INFO1/INFO0 selection issue for application/GPIO recovery,
fixed at SBL 1.16. Effective device policy must therefore be identified rather
than assumed from an isolated candidate INFO0 word.

The original emulator SBL-entry model is an explicit behavioral contract. Its
positive fixtures assume recovery eligibility; they do not execute protected
ROM or validate all MRAM master/asset policy. The separate
`g2-firmware-emulator/src/g2emu/recovery_prerequisites.py` gate now checks
effective policy selection, MRAM master/wired/application controls, the
separate MRAM GPIO trigger, key preservation, chip support and pogo UART
parameters. Its tests include missing/disabled policy and cold-reset key loss.
Even a positive result is only a candidate under explicit fixture assumptions,
with image authentication and physical reset/provisioning always unverified.

The charger-specific native experiment and policy limits are recorded in
`evenRealities-openCFW/g2/docs/reference/wired-recovery-charger-reset-boundaries.md`.
Its 262 native cases execute real BQ defaults/setters with an intercepted I2C
register fixture. They establish the code's effect, not the retail PMIC family,
register values, analog behavior or accessibility through the pogo contacts.

## Completion criteria

1. Identify a real, responding wired endpoint and bind it to the intended
   original temple and boot/recovery stage.
2. Verify a manufacturer stock package, its exact target regions, image format,
   hardware compatibility, authenticity requirements and current release.
   An `.evenota` file is not automatically an Ambiq wired-recovery image.
3. Complete the appropriate non-writing transport/identity/authorization checks.
   Preserve device-specific provisioning and calibration; do not program INFO/OTP
   as an exploratory entry technique.
4. Transfer/install through the identified wired protocol with its required
   acknowledgements and integrity checks, then verify stock application boot
   and bilateral wired version replies. Verify installed bytes where supported
   and report any verification limit explicitly.
5. Restore the case's normal routing/application and verify normal glasses
   operation. Do not mark the goal complete merely because case firmware ran,
   a simulator replied, a package built, or all currently feasible probes were silent.

No persistent case flash replacement is required for the current experiments:
the validated custom payloads run in SRAM with full stock-code identity checks.
A standalone case image or streaming bridge should be introduced when a
specific transport, timing or recovery-stage need justifies it.

## Native task-context prototype and live storage qualification

The next distinct W02 timing test uses the actual stock pulse at `0x0800B678`
from its native RTOS caller (`0x08009AFA` / `0x08009B10`). The earlier schema8
probe replayed actions and polled ticks. Phase A only records context and native
return; it implements zero UART query/image bytes. The hook is not installed.

Live stock-code readback succeeded twice after two prior read-only transport
failures. Fresh UID-bound 4KiB ROM read epochs avoid reusing a failed stream.
The case reports 512KiB flash. Saved full original pages `0x08009800` and
`0x0800D800` match stock code and a 1592-byte erased tail. The reserved 8192 SRAM
bytes survived five seconds of stock execution, and original SRAM was restored
and verified. Effective FLASH_OPTR read by a validated SRAM-only reader is
`0xDEEFE1AA`; stock case code selects physical bank2 for the lower logical range.
The bank-selector/erase-leaf audit passed18 native fixture cases, not hardware
erases or a proof of ROM Extended Erase page-index handling.

The prototype compiles to a 100-byte flash guard and 484-byte SRAM hook. All17
native context/fallback/one-shot/ABI cases passed, then passed again through
`g2-firmware-emulator/scripts/probe-case-native-task-context.py`. Task delay and
kernel fields remain fixtures, with no complete RTOS boot or physical timing
claim. Ten focused web checks and30 emulator prerequisite/reset regressions
passed. Six of the web checks reject incomplete coverage, changed payload,
missing provenance, false hardware claims and out-of-scope patch bytes.

`native-task-two-page-plan-v1/plan.json` contains exact original/patched pages
and order: install tail before call-site page; restore call-site page before
tail. It is offline and executionReady=false. No flash backend exists yet.
Next implement/validate scoped register/address/error/partial-write and restore
handling, reverify live UID/content/mapping, then perform one bounded context
qualification before adding actual native-pulse HELLO capture. No unrelated
flash, serial/calibration pages, OTP, options or protections are in scope.

Evidence under `work/usb-stock-recovery-20261104/goal/`:
- `native-task-storage-fresh-epochs-20261105T042716Z/qualification.json`
- `native-task-effective-mapping-20261105T043400Z/audit.json`
- `native-task-stock-bank-audit.json`
- `native-task-context-validated-v1/validated-manifest.json`
- `native-task-two-page-plan-v1/plan.json` and `native-task-source-index.json`

The case returned to stock1.2.57 and the USB port is closed. Hardware flash
writes and temple firmware-image transfers in this phase: zero. Last explicit
pair confirmation remains the original failed-update pair in the case; the
responsive BLE left temple has not yet been bound to either pair. No valid
wired SBL STATUS or successful glasses recovery has been observed.

## Scoped case page writer: offline faults and live read-only qualification

The native-task backend now compiles four exact page images into a9264-byte
SRAM program. There is no host-supplied address or page data. Modes are patch
(original only), restore(original including partial current pages), and mode2
read-only qualification. UID, OPTR,512KiB capacity, locked control state, busy
and error conditions gate the controller path. Logical pages0x08009800/0x0800D800
use the audited physical bank2 and local indices19/27 directly; no ROM erase
index mapping is assumed. No OTP/options/protection/mass erase is exposed.

All27 emitted-code cases passed, and were rerun through the G2 emulator:
`generated/recovery-native-page-writer/initial-run/report.json`. Both pages,
partial restoration, request/identity/options/size rejection, erase/program
errors, corrupt readback and stuck-busy phases are included. Flash behavior
remains a controller fixture; these runs do not qualify physical mutation.
Eighteen focused web checks passed, including source/artifact scope and SRAM
epoch retry behavior.

The first live upload failed before GO. Its first SRAM restoration also hit
a transport timeout; preserve the original failure audit. A separate repair
verified all32768 original bytes and restored stock1.2.57. The revised helper
uses fresh UID-bound1KiB SRAM epochs with at most one exact SRAM-only retry.
It never retries GO or flash operations.

The fresh live mode2 run completed both pages with status0, correct nonces and
page identities, zero erase starts, zero program doublewords, final SR0 and
CR0xC0000000. Both original pages remained identical; original SRAM was restored
and verified, and the case returned to stock1.2.57. The port is closed. The
mode2-only runner exposes no live patch/restore option. No case flash changed
and no temple query/image bytes were sent by this prototype.

Evidence under `work/usb-stock-recovery-20261104/goal/`:
- `native-task-flash-build-v2/validated-writer.json`
- `native-task-flash-readonly-20261105T045200Z/audit.json` and `sram-repair.json`
- `native-task-flash-readonly-fresh-epochs-v2/audit.json` and source snapshot
- `native-task-flash-source-index.json`

Next implement/validate the host transaction and explicit restore-only path,
including uncertain execution, partial pages and the no-boot-until-pages-verified
gate. Then perform a single bounded native RTOS-task context trial with exact
stock restoration. The hook remains uninstalled, physical erase/program/restore
are unqualified, and no wired SBL STATUS or glasses recovery is established.

## Real case page patch/restore trials and explicit reset trigger audit

The host transaction and saved restore-only command now exist. Nine policy
tests plus three adapter tests passed; focused native-task suite total30. The
policy preserves the guard until call-site restoration is verified and forbids
normal boot when original full code/pages/mirrors are unverified. Lost GO ACKs
are resolved by nonce-bound evidence/readback, never by replaying execution.

Two live transactions programmed/read back both patched pages. Across the
transactions and subsequent restore-only run, eight launched page operations
completed with successful controller status, exact full-page readback and
unchanged opposite-bank mirrors. Both original pages and stock code are now
restored. Physical partial-page/error-injection behavior remains unqualified.

Trial1 booted the patched application but the45-second passive window produced
zero retained hook evidence. This was an invalid timing choice: actual native
code divides by15 for log cadence and180 for reset. The eight-case native
trigger audit also executes B0's producer (event0x100) and the consumer branch
that invokes reset(1,1); event delivery/division/reset callees are fixtures.
DEB0 text framing uses the existing traced stock helper.

Trial2 used the explicit command path in its runner, but a ROM sync ACK timeout
stopped the transaction before context staging/boot. A second sync timeout
interrupted the final guard-page restore upload before GO. The case was held
in ROM; no normal boot was allowed. Its saved restore-only command subsequently
restored/read back the guard page, verified both originals, all original case
code, opposite-bank mirrors and all32768 SRAM bytes, then booted stock1.2.57.
The port is closed. Do not reinterpret the failed trial as a reset attempt or
retail recovery observation. No native hook evidence or wired SBL STATUS exists.

Evidence under `work/usb-stock-recovery-20261104/goal/`:
- `native-task-context-hardware-left-v1/audit.json` (passive window; full restore)
- `native-task-context-hardware-left-explicit-v2/audit.json` (sync failure; held ROM)
- `native-task-context-hardware-left-explicit-v2-restore/audit.json` (verified repair)
- `native-case-reset-trigger-audit.json` and `native-task-transaction-source-index.json`

Before another case flash trial, reduce needless full32KiB SRAM uploads and
ROM reset count, add bounded SRAM/read-only sync retries/diagnostics while
preserving UID/source/content gates, and qualify the revised staging path
without flash mutation. Then attempt the single explicit native-context test.
No custom temple UART queries or glasses firmware images were sent by these
context trials. The glasses remain unrecovered and the overall goal is active.

## Changed-range staging and real left native-task evidence

The revised loader compares required SRAM ranges, writes only changed1KiB
epochs, and retries only SRAM/read-only operations or pre-body connection
checks (at most three fresh UID-bound attempts). It never replays caller
bodies, GO or flash operations. Known-read mismatches retain raw bytes/hash
diagnostics; identity mismatches stop without retry. Nine new staging tests
and six console-gate tests bring the focused suite to45 passing checks.

Live mode2 staging qualification used9296 bytes then288 bytes,23408 total
including exact original SRAM restoration, with zero flash operations. Seven
USB timeouts were recovered; the root cause remains undetermined. Both exact
original case pages and full32KiB SRAM were verified; stock1.2.57 resumed.

The third native-context transaction obtained valid real LEFT evidence:
caller0x08009AFF, routeleft, nonce1257480298, IPSR0/PRIMASK0, scheduler2 before
and after, reset flag1 before and after, HAL tick3779 to3849 (delta70). GPIOB
ODR changed0x1C to0x21C; UART registers were [0,0,0,64] before/after. The raw
record was independently decoded against the journal. This establishes actual
case-task call/return around the original pulse, not pad pulse width or an
Apollo reset. The interval includes native routine/snapshots and scheduling.

The right attempt stopped on missing fresh temple-presence telemetry before
its DEB0 reset. Preserve left positive evidence despite the overall transaction
being context-not-qualified for the requested bilateral scope. Four page
operations restored both originals, complete stock code, mirror pages and
all32KiB SRAM; stock1.2.57 booted. Twelve launched page operations across all
trials/repair are now verified. No hook remains installed; USB is closed.

The new console helper captures full failure logs, retries only missing
read-only telemetry for up to three rounds, rejects actual absence/wrong UID/
active OTA, and sends at most one reset. A stock presence-only run observed
both contacts and OTA0, with no reset sent. Its captured stock polls still
show left/right response timeouts; presence is not application liveness.

Evidence under `work/usb-stock-recovery-20261104/goal/`:
- `native-task-stager-hardware-qualification-v1/audit.json`
- `native-task-context-hardware-bilateral-staged-v3/audit.json`
- `native-task-context-hardware-bilateral-staged-v3/native-context-left-result.bin`
- `native-case-console-presence-capture-v1/console.txt` and archived helper source
- `native-task-staged-context-source-index.json`

Next create a separate HELLO-only native-task probe around the authentic pulse,
preserve the live RTOS tick and native GPIO preparation, arm bounded early RX,
record route/context/overruns/capture, and validate emitted code and echo/STATUS
handling through the G2 emulator. Collect right context in that probe rather
than another phase-A-only flash cycle. No custom temple query or glasses image
bytes were sent by the context trials. Recovery provisioning and physical
Apollo reset remain unknown; no wired SBL STATUS or glasses recovery exists.

## Native-task HELLO hardware result and armed-SBL prototype

The schema-11 native-task HELLO probe completed on both original routes at
1 Mbaud. Each route executed from the actual stock reset task (IPSR0,
PRIMASK0, scheduler2, reset-lock1), returned from the stock pulse after71 HAL
ticks, sent20 fixed HELLO frames/160 bytes and received160 bytes whose retained
tail was exact HELLO echo. Neither route produced a CRC-valid STATUS. Four
exact page operations installed/restored the hook, then full stock code,
opposite-bank mirrors, all32KiB original SRAM and case1.2.57 were verified.
No case hook remains installed; no glasses image bytes were sent. This rules
out the earlier probes merely missing the native RTOS call context at the
tested1Mbaud path, but it does not prove an Apollo reset or configured SBL.

OpenCFW analysis identifies the remaining discriminating state: application-
initiated Apollo510 MRAM recovery. The experiment artifact arms
`MCUCTRL->OTAPOINTER=0xAFD1363A` before RAM initialization and disarms only
after a charging-case product response. The Even bootloader at0x00410000 is a
staged-file installer, not a pogo receiver; its0x007FE000 flag cannot rescue an
already dead application. Therefore the first positive-control test must use a
working secondary temple deliberately armed before insertion. INFO0/INFOC
master/application/wired enables remain unread and cannot be inferred.

The new schema-12 case prototype enters the stock DEB0 reset task while the
selected temple is absent, thereby holding the case's global transport busy
lock. It waits a bounded15000 HAL ticks without transmitting temple data, then
executes the original pulse and the same fixed HELLO capture. Its40 emitted-
code cases passed locally and again in the independent G2 emulator. The exact
two-page writer passed27 controller/fault cases locally and in the emulator.
Its live mode2 qualification completed both pages with status0, zero erase
starts and zero program doublewords; both original pages remained exact, full
original SRAM was restored and verified, and stock case1.2.57 resumed.

After the shared reset-trace source changed, the schema-12 probe and its
schema-11 base were rebuilt against current sources. The new probe passes 41
compiled cases and its writer passes 27. Their emitted hook and writer payloads
are byte-identical to the earlier hardware-qualified payloads. Current artifact
and staging-qualification inspection passes. The fresh secondary-left 115200
insertion-window command is prepared at
`work/usb-stock-recovery-20261104/goal/armed-sbl-secondary-left-115200-current-trace-command-v1.txt`.
It has not run: the original pair remains detected in the Case, and the
secondary pair must remain outside until the capture reports its armed cue.

The exact recovery bundle is now a local-only WebFlasher target pinned to file
SHA-256 `aab93fc75ec964ccd94171b90db5cc83f3026d257e008a2bd7fb177e43469af6`
and Apollo-main SHA-256
`bd4f242b8849e81b4d7d97ffcb1c78e7024251871c43da8833a9aa9368a182f5`
(3827984 bytes). Parsing confirms the complete six-component topology and the
existing direct-Bluetooth safety gate accepts only that exact artifact. It is
not yet wired-hardware-validated and has no unique postflight version/marker.
The operator confirmed `Even G2_32_L_4FB39E`, serial `S211GBBC180304`, is not
part of the original failed pair and explicitly authorized both the device and
firmware lanes.

An offline extraction and Thumb disassembly of that exact component—not merely
the current source tree—found the early arm routine at `0x004c0874`, its
startup call at `0x0060c09c`, the healthy disarm routine at `0x004c08cc`, and
the successful case-response call to disarm at `0x00533e0c`. The arm constructs
`0xAFD1363A` and writes `MCUCTRL->OTAPOINTER` at `0x40020264` without itself
requesting a reset. This confirms the transferred bytes contain the intended
experiment. It does not prove the updater installed those bytes, that the arm
executed, that a later reset occurred, or that retail SBL wired recovery is
provisioned. See
`work/usb-stock-recovery-20261104/goal/recovery-main-artifact-disassembly-audit.json`.

The official stock main component is also a direct prospective SBL image
candidate rather than an Even-only wrapper. Against the pinned Apollo510
`am_hal_secure_ota.h` layout, its 32-byte header declares a 3523396-byte Ambiq
standard image, requests CRC checking, uses nonsecure magic `0xCB`, targets
`0x00438000`, and carries a plausible vector table. Its stored CRC-32
`c91081df` exactly matches CRC-32 over bytes 8 onward, and its complete SHA-256
is `36c5b0e499a68ac2493a497bdab9740fd3e7027730c26a9094eca47268a27863`.
The header does not request authentication or encryption. This makes the exact
stock component structurally usable if the retail SBL policy accepts that
image class; it does not show that policy is enabled or permissive. No
UPDATE/DATA writer has been armed. See
`work/usb-stock-recovery-20261104/goal/stock-main-sbl-envelope-audit.json`.

The exact Apollo510 wired framing is no longer inferred from the older Apollo3
tool. The local AmbiqSuite 5.2.0 archive, SHA-256
`d9751350ef593b306838792a64a5620e4912c84ddf32dc9ff6aacd5cca049cad`,
contains the vendor Apollo510 host at revision
`release_sdk5p2p0-66487dd10`. It confirms a 96-byte STATUS, 20-byte ACK,
8192-byte maximum UART message, 8180-byte DATA payload, STATUS-advertised
storage capacity, reverse-order standard-image segments, and DATA sequence as
the zero-based byte offset within a segment. The vendor host defaults to
115200 baud and retries explicit NACKs up to four attempts. The recovery writer
keeps zero retries: a timeout is ambiguous and a NACK stops for audit rather
than broadening the mutation policy. The exact stock
main is one 3523396-byte segment. The vendor maximum payload would require 431
DATA frames, but the qualified Case bridge accepts at most 1009 request bytes,
so the physical route is bounded to 997 image bytes per DATA frame: 3534 DATA
frames and 3537 mutating transactions. At least 3522932 advertised storage
bytes are required. Capacity therefore remains unknown until a real STATUS
arrives.

The pending armed positive-control probe is no longer single-baud. Its runner
requires an explicit rate and has qualified host fixtures for both the Ambiq
vendor default at 115200 and the Even application rate at 1000000. The first
physical insertion will use 115200; only a qualified no-STATUS result may be
followed by a fresh 1000000 run. Silence at either rate remains negative
evidence for that window, not proof that SBL is absent.

The vendor tool's default descriptor page `0x004FE000` is not used: it lies
inside the G2 stock main span beginning at `0x00438000`. The offline prototype
hard-pins the reviewed G2 final-MRAM updater page `0x007FE000`, validates CRC,
ACK type/status/sequence, and has no serial transport. Its five focused framing
tests pass. A stateful g2-firmware-emulator fixture additionally rejects an
under-capacity STATUS, accepts the exact threshold, reassembles all 3523396
stock bytes both across the vendor's 431 DATA frames and across the Case-bounded
3534 DATA frames, and rejects a duplicate sequence and corrupt command CRC. All
six emulator cases pass with zero physical-device bytes sent.

A compiled schema-13 volatile Case bridge now restricts temple requests to the
exact HELLO, G2 descriptor at `0x007FE000`, exact stock UPDATE tuple, bounded
DATA range and POI reset. Its 196-byte validator fits the inherited bridge slot
and passes every-byte corruption of each permitted
frame, targeted forbidden commands and 1000 deterministic random frames. The
two emitted bridge artifacts are baud-bound: the 115200 build writes BRR 556
after both stock transmit and receive initialization, while the 1000000 build
writes BRR 64 at those same call sites. A Unicorn execution case verifies each
24-byte baud patch, bringing each build to 29 cases, and the inspector refuses
to reinterpret one artifact as the other baud. The
injected-transport host state machine adds seven tests proving exact risk-token,
image, STATUS identity and capacity gates; strict ACK type/status/sequence;
zero retries; ambiguous-stop handling at every mutating phase; and a complete
3534-frame exact-stock fixture. Neither the schema-13 bridge nor the host writer
has executed against hardware. An artifact inspector adds three tamper/boundary
tests. A dedicated live binding now connects those layers without opening a
device on import: construction requires both exact operator risk tokens, a
fresh artifact inspection and an explicitly pinned bridge SHA-256. It permits
each exact stock command only once, makes malformed order or an ambiguous I/O
failure terminal, and accepts the bridge's delayed 96-byte STATUS framing.
Its five transport tests pass; it has not opened the physical Case. The target
endpoint binder additionally requires a pinned schema-12 audit and
STATUS digest, exact route agreement, zero probe image bytes, and verified
restoration of stock Case firmware before a write can be constructed. The
evidence-bound runner refuses insufficient SBL capacity before opening the
device and declares recovery only after every write/reset ACK, verified Case
restoration, and a fresh wired `2.2.6.10`/hardware-5 application query. Five
additional binder/runner tests pass. The complete `test_g2_sbl*.py` family
passes 91 tests. This proves exact host framing,
offline reassembly and fail-closed orchestration, not protected-SBL behavior,
retail acceptance or a live write. See
`work/usb-stock-recovery-20261104/goal/apollo510-sbl-wire-framing-audit.json`,
`scripts/g2_sbl_wire.py`, `scripts/g2_sbl_writer.py`,
`scripts/case_sbl_stock_writer/`, and
`/Users/kalani/Repo/g2-firmware-emulator/work/apollo510-sbl-wire-v2/report.json`.

The local target now carries an immutable component restriction to
`ota/s200_firmware_ota.bin` and a left-only validation scope. The browser UI
requires only the explicitly labeled left device for this target, records the
unselected right as an unchanged control, and does not expose the ordinary
two-temple write action. The schema-12 runner has focused host checks proving
that malformed requests stop before ROM I/O, all512 evidence bytes are cleared,
the reset helper emits exactly one `DEB0` and no query, and qualified silence
remains a no-STATUS result. The focused browser suite has53 passing tests; the
full browser suite has466 passing and12 explicitly skipped tests with zero
failures; and the production Vite build succeeds. These are software controls,
not evidence
that the secondary identity is bound or that retail MRAM SBL is enabled.

The production preview was also exercised through the rendered local-file
workflow. It revalidated the exact bundle, rendered only `Select LEFT temple`,
named the target `Local OpenCFW MRAM/SBL recovery experiment 1101`, stated that
only the Apollo main is eligible, and stated that the other temple and five
other Glasses components remain unchanged. The preview browser has no Web
Bluetooth support, no device was selected, no permission prompt was opened,
and this is UI/runtime-gate proof only—not a hardware transfer.

The production build in Chrome selected only `Even G2_32_L_4FB39E`. It
authenticated the stock G2 link, transferred only
`ota/s200_firmware_ota.bin`, received935/935 block acknowledgements, and
verified final END status8 (`UPDATING`). The right control remained unchanged.
The operator subsequently confirmed that this experimental image was the image
used for that transfer; `4FB39E` remains bound to the secondary-control left,
not to the original failed-update pair.
Chrome's saved handle then produced four consecutive stale-cache/no-range
responses after reboot, so the browser correctly retained the transfer as
`awaiting_case_verification`; it did not replay firmware. This proves complete
staging and updater handoff, not that the new application has booted or that
MRAM SBL is enabled. The full41-entry transcript was downloaded as
`/Users/kalani/Downloads/g2-recovery-2026-11-05T08-19-27.221Z.log`, SHA-256
`3bff8608242fc9bd863a533f251ef00c96a890f327762c61c28d6d16455a281f`.
Three fresh CoreBluetooth scans ending at08:20:53,08:21:36 and08:22:16 UTC
did not observe `4FB39E`. This does not distinguish a long updater apply,
non-advertising recovery state, depleted power or failed application boot. It
does make the wired probe, rather than a speculative firmware replay, the next
discriminating test.

Three 115200 hardware runs have now completed with full stock Case restoration,
but none is a qualified no-STATUS result. The first run stopped with status
1 before the insertion wait: its retained evidence showed the real empty-Case
disabled UART had saved BRR 0, while the original fixture required 64. It sent
zero temple bytes. The superseding hook accepts only saved BRR 0 or 64 and
restores the exact saved value; 41 compiled-hook cases pass, including the
hardware-derived BRR-0 context. Its new writer passed 27 controller cases and
two live mode-2 pages with zero erase/program operations, unchanged Case pages,
restored SRAM and stock 1.2.57.

The second run passed that precondition and reached exchange stage 4, but the
27-second host timer interrupted it at attempt 10 of 20. The torn result had
transmitted and received 80 exact HELLO/echo bytes with zero UART errors; it had
not yet written final magic or checksum, so it is not transport silence and is
not qualified evidence. Rollback again verified both original pages, mirrors,
SRAM and stock 1.2.57. A third run used a 45-second host window but produced the
same stage-4 attempt-10 state, again with 80 exact HELLO/echo bytes and zero UART
errors. This repeatable point is therefore a live-task stall rather than merely
the former host deadline.

The inspected Ambiq host implementation permits one initial HELLO plus three
communication-error retries (`MAX_COMM_ERR_COUNT = 3`). A superseding probe is
therefore bounded to four attempts and at most 32 temple bytes, below the
repeatable tenth-window stall. It passes 41 compiled-hook cases, 27 writer
cases, 96 combined host/SBL tests, and independent 41/27-case emulator runs.
Its live mode-2 staging gate has not yet run. The 1000000 fallback remains
prohibited until a complete, checksum-valid 115200 result qualifies with no
STATUS.

Evidence:

- `work/usb-stock-recovery-20261104/goal/native-task-hello-hardware-bilateral-v1/audit.json`
- `work/usb-stock-recovery-20261104/goal/armed-sbl-probe-build-v7-four-attempt/validated-manifest.json`
- `work/usb-stock-recovery-20261104/goal/armed-sbl-probe-writer-build-v3-four-attempt/validated-writer.json`
- `work/usb-stock-recovery-20261104/goal/armed-sbl-positive-control-left-115200-hardware-v1/audit.json`
- `work/usb-stock-recovery-20261104/goal/armed-sbl-positive-control-left-v2-115200-hardware-v1/audit.json`
- `work/usb-stock-recovery-20261104/goal/armed-sbl-positive-control-left-v2-115200-hardware-v2/audit.json`
- `work/usb-stock-recovery-20261104/goal/armed-sbl-hardware-revision-audit-v1.json`
- `g2-firmware-emulator/work/case-armed-sbl-v3-four-attempt/report.json`
- `g2-firmware-emulator/work/case-armed-sbl-writer-v3-four-attempt/report.json`
- `scripts/test_g2_armed_sbl_runner.py`
- `tests/g2-armed-recovery-identity.test.mjs`

Next confirm the secondary is outside, qualify the four-attempt writer in live
mode 2, then run the vendor-bounded schema-12 115200 empty-case probe; insert
the complete secondary pair during its 15-second cue, because the case cannot
seat one temple independently. Qualified 115200 silence
permits one fresh 1000000 run but
does not by itself prove SBL absent because experimental installation and the
physical Apollo reset class remain unverified. A valid secondary STATUS advances
to a separate read-only original-target probe; it never supplies the original's
identity. The original pair remains untouched by this positive-control experiment.

The first live qualification attempt for that four-attempt writer failed
closed at preflight on 2026-11-05T21:09:42Z. A fresh stock Case 1.2.57 console
reported both `GLS_L:1` and `GLS_R:1` even though the expected physical state
was empty; both temple status requests timed out. The qualifier attempted zero
SRAM bytes, zero flash writes and zero temple-query bytes. This output is not a
qualification and cannot arm a probe. The next gate is a visually empty Case
followed by one USB power cycle while empty, then a fresh mode-2 qualification
directory.

OpenCFW's stock Case decompilation at `0800CE34` shows that `GLS_L` and
`GLS_R` are recomputed through YHM2510-selected STM32 ADC contact sensing with
a raw threshold of 620; UART reply timeouts do not set those flags. A live,
read-only Jumperless inspection subsequently found only its three infrastructure
bridges and no route involving breadboard rows 20-23, so stale virtual
Case-to-glasses links cannot explain the two active presence flags. The next
empty-Case attempt therefore also requires every Dupont lead to be physically
removed from the Case pogo contacts. Evidence is bound in
`work/usb-stock-recovery-20261104/goal/empty-case-presence-gate-audit-v1.json`.

## Superseding target-bound depleted-insertion result (2026-11-08)

The empty-case gate was later cleared with all external contact wiring removed.
Schema-14 v10 was hardware-qualified with the Case dormant BRR accepted only as
0 or 64, a watchdog-headroom budget of 12,000 pre-pulse plus 3,000 post-pulse
SysTick wraps, first-byte-saturating 1,020-byte retention and zero temple TX.
Its live mode-2 qualification covered both pages with zero erase/program starts,
unchanged candidates, exact original SRAM restoration and stock Case 1.2.57.

After a checksum-valid empty-case control, a second window expired before the
operator inserted anything and was classified only as another empty-case
control. It is not target evidence. A fresh v3 run then passed UID-bound stock
and empty-contact gates. The operator inserted the entire fully discharged
original prescription pair only after the runner printed `ARMED PASSIVE LEFT`.
The qualified receiver completed all 15,000 wraps with zero RX bytes, zero UART
errors and zero temple TX. It restored both original Case pages, opposite-bank
mirrors, the original 32 KiB SRAM snapshot and stock 1.2.57.

Fresh post-run telemetry reported `GLS_L:1`, `GLS_R:1`, inactive temple OTA and
the exact Case UID. Both stock temple status routes timed out eight times and
reported no reply. The operator confirmation plus bilateral contact telemetry
binds v3 to the intended original pair. The result still does not prove an
Apollo reset, physical temple TX, SBL absence, provisioning state or recovery.
It is a completed D02 discriminator with inconclusive silence, not a recovery
mechanism and not authorization to send stock bytes.

Authoritative evidence:

- `work/usb-stock-recovery-20261104/goal/case-even-bootlog-capture-original-left-watchdog-headroom-hardware-v3/audit.json`
  (SHA-256 `0b7d0a55b75e3ff18fa808801bc28172b2db46ebdad24f1386b72bf819b23303`)
- `work/usb-stock-recovery-20261104/goal/case-even-bootlog-capture-original-left-watchdog-headroom-hardware-v3/post-run-presence.json`
- `work/usb-stock-recovery-20261104/goal/case-even-bootlog-capture-stager-qualification-v7-watchdog-headroom/audit.json`

The next experiment must resolve a new unknown: electrical Apollo reset/power
delivery or temple TX activity. An unchanged silent UART probe is not scheduled.
A schema-13 writer remains fail-closed until a CRC-valid original-target STATUS
also binds route, baud, endpoint identity, provisioning and sufficient capacity.

### Diagnostic discriminator D03: raw Case-PB9 activity

The target-bound D02 result left two materially different explanations for
zero UART bytes: the temple-to-Case line may have had no electrical activity,
or activity may have been present but undecodable under the selected UART
configuration. Schema 15 adds raw digital sampling of STM32 `GPIOB_IDR` bit 9
on every receive-loop iteration. It keeps independent sample, transition,
low-level and first/last-level counters for the 12,000-wrap pre-pulse phase and
the 3,000-wrap post-pulse phase while retaining 988 first UART bytes.

The 1,704-byte compiled hook has no UART transmit-register path. Twelve static
and parser cases pass. Eight executions of the emitted hook distinguish
constant-high, stuck-low, pre/post toggling and post-pulse transitions with zero
decoded UART bytes; all record zero temple TX. An independent emulator runner
re-executes the same artifact and cases. Its exact two-page patch/restore plan
and 9,264-byte writer pass 27 controller/fault cases. Thirteen host tests verify
the exact build, edge-without-UART distinction, stuck-low distinction,
independent report, staging bounds, source provenance and transactional backend.

This is still a diagnostic, not a recovery mechanism. PB9 transitions would
prove only digital activity at the Case receive input. They would not identify
the external driver, prove Apollo reset, authenticate a boot stage or establish
retail recovery policy.

Evidence:

- `work/usb-stock-recovery-20261104/goal/case-pogo-edge-capture-build-v1/validated-manifest.json`
  (SHA-256 `32f34e27c313a25577e233a028f895596139d5660b867f55510d3214fb2f906f`)
- `/Users/kalani/Repo/g2-firmware-emulator/work/case-pogo-edge-capture-v1/report.json`
  (SHA-256 `dfb7f4bcbea187276957b448a25df4920f288311b889c0a3cbad1166e7fa243b`)
- `work/usb-stock-recovery-20261104/goal/case-pogo-edge-capture-plan-v1/plan.json`
- `work/usb-stock-recovery-20261104/goal/case-pogo-edge-capture-writer-v1/validated-writer.json`
- `scripts/test_g2_pogo_edge_capture.py` and
  `scripts/test_g2_pogo_edge_capture_runner.py`

The writer subsequently completed live mode-2 staging qualification on both
pages with zero erase starts, zero programmed doublewords, unchanged original
pages, exact SRAM restoration and stock 1.2.57. The first transactional D03
hardware run then completed while the Case remained empty. PB9 stayed high for
8,470,418 pre-pulse and 2,117,101 post-pulse samples with zero transitions and
zero UART bytes. Both original Case pages, mirrors, the 32 KiB SRAM snapshot and
stock 1.2.57 were restored. This validates the physical Case-side observer and
establishes its empty-input baseline, but it is not target evidence. A fresh
operator-timed run remains required with the original pair inserted only after
the armed cue.

A second transactional run also remained physically empty: fresh post-run
telemetry reported `GLS_L:0` and `GLS_R:0`, so it is not target evidence. PB9
again stayed high for 8,470,430 pre-pulse and 2,117,105 post-pulse samples with
zero transitions and zero UART bytes. The full Case image, mirrors, SRAM and
stock 1.2.57 were again restored and verified. A fresh v3 command is held until
the operator explicitly reports `Ready` before launch. That gate was later
satisfied for the target-bound v3 run below.

The v3 run subsequently armed before operator-confirmed insertion of the entire
original prescription pair. Fresh preflight and post-run telemetry bound both
contacts to the target. PB9 remained high for 8,470,413 pre-pulse and 2,117,101
post-pulse samples, with zero transitions, zero low samples and zero UART bytes.
The full Case image, mirrors, 32 KiB SRAM snapshot and stock 1.2.57 were restored.
Both stock version queries then timed out. This is target-bound evidence that the
Case PB9 input did not observe a digital transition during the sampled window;
it does not prove that Apollo reset, that the glasses-side line was electrically
connected, or that a boot stage executed.

### Diagnostic discriminator D04: Case PB9 level while driven

Schema 15 sampled PB9 before and after the pulse, leaving its level *during*
the commanded train unmeasured. The prepared SRAM bridge now samples
`GPIOB_ODR` and `GPIOB_IDR` immediately after every PB9 command. Its retained
result distinguishes a matching output latch, a matching digital pad input,
and observed low/high levels. Compiled stuck-high and stuck-low pad fixtures
show that the two mismatches are reported without inventing an SBL STATUS.
The new right-route 1-Mbaud build at
`work/usb-stock-recovery-20261104/goal/reset-prepared-right-1000000-pinlevel-build-v1/`
passes 39 compiled cases; refreshed route/baud, forced-PB8, charger-cycle and
seven waveform fixtures also pass. The focused reset/waveform/ledger suite
passes 20 tests. Live D04 probes then ran against the currently seated load on
both routes at 1 Mbaud. Both preflights detected two temple contacts, both
completed the full 103-action train and 20 HELLOs, and both reported that the
PB9 output latch and digital input matched every sampled command, with at
least one driven-low and one driven-high input observation. Both retained only
HELLO-compatible echo, captured no valid SBL STATUS, cleared retained evidence,
wrote no Case flash, sent no firmware bytes and restored stock Case 1.2.57.
A fresh stock version query still received no valid application reply on either
route. Evidence:
`work/usb-stock-recovery-20261104/goal/case-pb9-pinlevel-current-seated-{right,left}-1000000-hardware-v1.json`
and `post-pinlevel-current-seated-version-20261109-v1/audit.json` in the same
goal directory.

The operator has not yet confirmed whether the seated load is the original or
secondary pair after the requested swap, so these results are bound to the
Case and two detected contacts, not to a named pair. They rule out a Case PB9
pin stuck at one digital level during these runs. A Case-side digital level is
still not a glasses-pad voltage or a physical Apollo reset.

### Reconnected, confirmed original pair and external bootloader patch

On 2026-11-09 the operator explicitly confirmed the original prescription pair
seated after reconnecting USB. The fresh stock Case 1.2.57 diagnostic detected
both contacts and inactive Case OTA, but both read-only application-version
requests timed out. A new right-route 1 Mbaud pin-level probe completed all 103
stock PB9 actions and 20 HELLO requests. Case GPIOB PB9 ODR/IDR followed the
commanded low and high levels; the 160 received bytes were HELLO-compatible
echo only. There was no CRC-valid Apollo SBL STATUS or bootloader beacon. The
retained result was cleared, the Case returned to stock 1.2.57, and no firmware
bytes or Case flash writes occurred. A 12-second BLE scan found no candidate.
These observations bind the negative result to the original pair, without
proving a physical Apollo reset or the electrical state at the glasses pads.
The postprobe read-only Case version queries again timed out for both temples,
with USB closed afterward. Evidence:
`work/usb-stock-recovery-20261104/goal/reconnected-original-stock-version-20261109-v2/audit.json`,
`case-pb9-pinlevel-confirmed-original-right-1000000-hardware-v1.json`, and
`post-confirmed-original-probe-version-20261109-v1/audit.json`.

The newly published [g2-bootloader-patch](https://github.com/drdaeman/g2-bootloader-patch)
implements a Case SRAM relay and pogo UART2 boot hold, RAM loader, and direct
MRAM recovery writer. Its documented installation uses the stock application's
BLE OTA path to patch the Even bootloader **before** an application failure.
Its Case reset uses the same stock waveform we already emitted. The project
states retail Ambiq SBL wired recovery is disabled and the unpatched Even
bootloader has no pogo image receiver. This is a source-author claim, not a
readout of the original pair's INFO0/INFOC configuration or bootloader bytes.
The patch cannot be assumed present on these original glasses; no matching
21-byte HELO beacon was observed in this probe.

On 2026-11-10, the community project's actual Case relay was built from its
current `6198d70` source with LLVM 21. The pinned `patch.bin`, `case.bin`, and
`echo.bin` hashes reproduced; all 120 tests passed with the hash-verified
official 2.3.2.14 bundle present. The author relay first returned a complete
Case `G2RS` status-3 packet, which its host had mistaken for a truncated UART
register response. A fresh ten-register YHM read showed the Case baseline
`811104afaf038d2033ff` with mask `0x3ff`. The only change to the derived Case
SRAM relay was the five reviewed baseline-table bytes at offsets
`1660,1670,1680,1690,1700`, each `0x22` to `0x33`; its SHA-256 is
`7b2bd5ade92fed4903f2da08736065c4422a72f58e19a47425ca5e9f98cbf7d9`.
The Case flash stayed stock.
After both runs, a separate ten-register readback matched stock Case flash,
read mask `0x3ff`, and the allowed charging-phase baseline
`811004aeaf03812033ff`. The stock application advanced its YHM phase, so
the postflight ten bytes are not identical to the earlier preflight snapshot.

The local community-tool adaptation exposes that exact Case profile in its
boot, recovery, alternate-boot, and BLE-install verification commands. It also
decodes an early `G2RS` exit as a Case status rather than waiting for an
impossible register or beacon length. The default Case build still matches the
author's pinned SHA-256. An offline `recover.py` dry run accepted the pinned
2.4.0.24 official bundle and extracted a 3,700,068-byte MRAM application at
`0x00438000` (SHA-256
`df8cfddf3bd29a8351129a8364a8e0dafb347ffc7bfcbca5b52fdd973a7cce4a`);
it accessed no device. This prepares a latest-stock path if a patched loader
is authenticated on a target, but provides no path to install that loader on
the currently silent original pair.

With that exact profile, both seated original routes reported UART registers
`[5,0,64,4194496]`, emitted the Case UART2 armed marker, then returned valid
Case `G2RS` status 6: no framed temple boot beacon. The left raw exit packet
was retained before the parser fix; the right packet was parsed live. Each run
restored stock Case 1.2.57, and a fresh postflight found both contacts, inactive
OTA, and the exact Case serial. No temple firmware bytes, HMAC claim, RAM
program, or Case-flash bytes were sent. A 12-second BLE scan found only an R1,
no G2 candidate. This is negative evidence for an *accessible patched loader*
on the current original-pair path, not proof that the patch is absent: physical
Apollo reset and UART electrical delivery remain unverified. Evidence:
`work/usb-stock-recovery-20261104/goal/community-patched-bootloader-original-case-relay-20261110-v1.json`.

The schema-13 offline writer now accepts exact stock image SHA-256 pins for
2.2.6.10, 2.3.2.14, and 2.4.0.24, compiles each image's length and CRC into its
request validator, and binds postflight to the version matching the image hash.
The 2.4.0.24 source bundle was fetched from the primary and mirror Even CDNs;
both 4,482,361-byte downloads matched byte-for-byte, MD5
`a0d486afe862a9121657477b98667c95`, and SHA-256
`363198f8d543a5c1181d8a213e9077285cb865700a1885c8dc7c1b9324fd0e05`.
Its embedded version, six component names, types, sizes, CRC32C values, and
digests parsed with WebFlasher and match the [independent rebase record](https://github.com/rayriffy/even-g2-thai/blob/main/docs/rebases/2.4.0.24.json).
The main image SHA-256 is
`33f9eb7a47f996b8bcf34ac9df8bc2f7b698a6512cbf370d25b3215ad0dde298`;
it is 3,700,100 bytes, CRC-valid, nonsecure, loaded at `0x00438000`, and
requires at least 3,699,636 advertised storage bytes. Each 2.4.0.24 baud build
passed 29 Unicorn cases. The 2.2.6.10 and 2.3.2.14 artifacts were rebuilt
against the same source. All 99 SBL tests pass. The per-route runner reports
only `targetStockApplicationResponsive` after a matching version reply; it
keeps `glassesRecovered=false` until bilateral boot and stock identity are
verified separately. No schema-13 image was sent, and the original target
still lacks a live SBL STATUS. See
`work/usb-stock-recovery-20261104/goal/stock-2.4.0.24/` for the two source
downloads, parsed component manifest, extracted main, and SBL envelope audit.
Schema-13 currently writes only the Apollo main component. The 2.4.0.24
bundle also contains changed bootloader, codec, BLE, touch, and Case components;
a responsive main would be a bootstrap for the normal complete stock updater,
not proof that every component is already at 2.4.0.24. A final pair-recovered
claim needs both temples booting and complete stock component/version checks.
The local WebFlasher release generator, shipped catalog, stock flash target,
and production build now include this exact 2.4.0.24 bundle. The shipped and
dist catalogs list it first with the same source SHA-256. The WebFlasher suite
passes 466 tests, skips 12, and fails none; the production Vite build passes.
This publishes bytes locally in the repository, not to a hosted site or the
unresponsive original glasses.

### W04 active PB8 forced-strap matrix

The schema-8 prepared-UART bridge now has an active `pb8-low` / `pb8-high`
option. It drives Case PB8 push-pull across the complete stock 103-action PB9
train, releases both pins, enables the selected UART route, and emits exactly 20
Ambiq HELLO frames. The READY record and retained result bind the requested
level; compiled fault injection rejects a latch mismatch before any temple byte.
Thirteen focused host/emulator tests pass.

All eight target-bound combinations were executed on the seated original pair:
left/right route, PB8 low/high, and nominal 115200/1,000,000 baud. Every run
completed 103 actions and 62 delay ticks, sent 160 HELLO bytes, received 160
bytes consisting only of exact repeated HELLO frames, captured no CRC-valid SBL
STATUS, cleared its retained result, and restored stock Case 1.2.57 with zero
Case-flash writes. Release-to-first-TDR upper bounds were 348–357 checked cycles
(5.4375–5.578125 microseconds at the checked 64 MHz Case clock).

This exhausts only the Case-PB8 candidate held high/low across this exact stock
PB9 train on the two reviewed routes and bauds. It does not establish the source
of the echo, a physical Apollo reset, the retail BOOT_OVERRIDE pin/polarity, the
wired UART framing, or whether Case PB8 reaches Apollo GPIO44 on this hardware.
Unknown device-bound override pins, PMIC reset and true power-cycle mechanisms
remain unresolved.

### W02 charger-route cycle before the stock train

The same bridge now has a separately bound `route-ae-af` mode. It configures
the selected Case route and UART, arms receive, writes the stock left/right YHM
control (register 3 or 4) to `0xAE` for 3,000 ms, writes `0xAF`, and retains a
50-ms return window before running the exact PB9 train and HELLO schedule. The
READY record binds this mode. Its retained result separates UART errors observed
during route switching from errors in the subsequent reset/HELLO window. A
failed AE/AF write restores the original YHM image and sends zero temple bytes.
Four route/baud artifacts pass 38 compiled execution and fault cases each; the
focused schema-8 suite now passes 18 tests.

The first left/1-Mbaud hardware run correctly failed closed because the route
transition produced two zero bytes and UART error mask `0xA`. After separating
that evidence from the recovery window, all four target-bound combinations
(left/right and 115200/1,000,000) produced the same result: two invalid zero
bytes with pre-cycle mask `0xA`, then 160 bytes of exact HELLO echo, no post-reset
UART error and no CRC-valid STATUS. Each run completed the 103-action train,
restored exact YHM/GPIO state, cleared retained evidence, wrote no Case flash and
returned to stock Case 1.2.57. A fresh read-only stock diagnostic still found
both contacts but obtained no version reply from either temple.

This closes the reviewed AE-to-AF Case charger/pogo route cycle as an SBL entry
attempt at the two reviewed bauds. It is not a true temple power cycle: each
temple has its own battery, and no pogo-to-PMIC reset circuit is known. The two
invalid bytes are repeatable route-transition activity, not authenticated Apollo
output. PMIC reset/ship/watchdog remains a separate mechanism.

### W02 bounded PB9 waveform sweep

Seven stock-derived or bounded PB9 waveform variants ran on each original-pair
route at 1 Mbaud: inverted levels, half/double busy delays, doubled stock
train, and 100/1000/3000-ms low holds. The inverted train and 3000-ms hold
also ran on both routes at 115200 baud. All 18 runs passed compiled fault
qualification before hardware, completed their programmed actions and 20
HELLO requests, sent 160 bytes, counted 160 receive bytes, and retained only
HELLO-compatible echo. No CRC-valid SBL STATUS was captured. Every run verified
exact Case GPIO/YHM cleanup and stock Case firmware 1.2.57 restoration. A fresh
stock diagnostic then detected both temple contacts but received no valid
application-version reply on either route. The complete per-run path, hash,
route, baud, action count and result are in
`work/usb-stock-recovery-20261104/goal/waveform-hardware-summary-20261109-v1.json`;
the postflight version audit is
`work/usb-stock-recovery-20261104/goal/post-waveform-stock-version-original-20261109-v1/audit.json`.

These are target-bound Case-output experiments, not measured Apollo reset
events. Case PB9 most plausibly couples to the glasses' UART2 TX contact;
neither an Apollo reset-input path nor its retail boot override configuration
has been demonstrated. Further PB9 timing changes without new electrical or
provisioning evidence would not distinguish entry failure from an unconnected
reset mechanism. No stock image byte was transferred to the original pair.

The glasses-side source trace now binds the application channel more tightly:
stock `box_uart_mgr` uses logical UART 2, and the recovered board channel table
configures it for 1,000,000 baud. The table's reconstructed `rx_pin`/`tx_pin`
field names are reversed relative to the pinned Ambiq mux header: GPIO42 is
UART2 TX and GPIO44 is UART2 RX. Thus Case PB9, its normal receive/temple-return
line, most plausibly couples to the GPIO42 TX-side contact. The Case drives
that line during its waveform, but no reconstructed pogo-to-PMIC/Apollo reset
circuit was found. The Case function name therefore remains semantic evidence,
not proof of physical Apollo reset or SBL entry.

The Apollo SBL also cannot be inferred from the application pin table. INFOC
`WIRED_CONFIG` selects UART versus SPI and the UART module, while device-bound
INFO0 `SECURITY_WIRED_IFC_CFG0..5` independently defines baud, framing, four
pin numbers and raw pin configurations. INFO0 `MRAM_RCVY_CTRL.WIRED_RCVY_EN`
is a separate recovery gate, and INFOC `BOOT_OVERRIDE` separately selects its
GPIO and polarity. The failed target cannot expose these values through the
application product-test channel. A CRC-valid SBL STATUS, a debugger read, or
a separately instrumented healthy temple remains necessary to bind them. The
source hashes, addresses, masks and proof boundary are frozen in
`work/usb-stock-recovery-20261104/goal/apollo510-sbl-provisioning-gates-audit-v1.json`.

Additional evidence:

- `work/usb-stock-recovery-20261104/goal/case-pogo-edge-capture-stager-qualification-v1/audit.json`
  (SHA-256 `65715a7b15ea3e15b7de929ff3acc712aaf985d549164640a11d92e0336166b0`)
- `work/usb-stock-recovery-20261104/goal/case-pogo-edge-capture-original-left-hardware-v1/audit.json`
  (SHA-256 `1e27a185ad712c1d0b8a2ddd8dcd382c42d6e6eb2ff92702a3519687ec6b9d4b`)
- `work/usb-stock-recovery-20261104/goal/case-pogo-edge-capture-original-left-hardware-v2/audit.json`
  (SHA-256 `8ae8fca935a3335405f1fb5f4abc08ee26a8a1d36ba8ca188cc8082f94d5a331`)

## 2026-11-11 seated software-reset control and secondary probe

`scripts/g2_seated_reset_control.py` now performs a single stock Case `DEB0`
reset with both temples seated, records the Case acknowledgement, queries both
application versions through the observed charging-phase SRAM relay, and
records route restoration. It also supports a read-only seated recheck. It never
replays an uncertain reset. Four workflow tests pass, including no reset after
failed preflight, no replay after a lost acknowledgement, and no reset in the
read-only mode. This lets further Case control tests run without moving
the glasses. The Case acknowledgement proves command handling; no Apollo reset
input or reset class has been measured.

The secondary pair was detected on both contacts after the timed schema-12
insertion window had ended. That earlier run retained four HELLO echoes but
postflight showed `GLS_L:0, GLS_R:0`, so it is an empty-Case result rather than
a negative secondary result. After seating, one software reset was acknowledged
and both version routes timed out. Two later read-only rechecks also found
both contacts present and no version replies. A 20-second Bluetooth scan found
no G2 advertisement; in-Case advertising policy and charge state remain unknown.

While the secondary pair stayed seated, stock PB9 reset plus early SBL receive
completed on left at 115200 and 1000000 baud and right at 1000000 baud. Each
ran all 103 reset actions and 20 HELLO attempts, retained only HELLO-compatible
echo, found no CRC-valid STATUS, and returned the Case to stock 1.2.57. Right
115200 produced the same UART framing-error mask `2` on two independent runs,
each after one HELLO echo plus one `00` byte. This is reproducible Case-side
UART behavior on that route, but does not identify a temple driver or constitute
a bootloader frame. Neither original nor secondary has a verified recovery
endpoint, and no glasses firmware image bytes were sent.

After approximately the operator-reported 18-minute full-charge interval, a
read-only seated recheck still found both contacts, stock Case 1.2.57 and no
application version on either route. Three transient right-route setup-status-3
attempts did not expose a per-attempt YHM restoration proof; the final right
route did restore its baseline, and the fresh Case postflight passed. The
recheck sent no reset and no firmware bytes.

Combined evidence: `work/usb-stock-recovery-20261104/goal/secondary-seated-software-recovery-audit-20261111-v2.json`
(SHA-256 `fa9a7f0dc6183cf3fef0acb806a12f70564e50f5b7f5f1a65ba30d0cd1c7bf05`).

### Fixed application reset command prepared

The stock `pt_cmd_08_handler` for product command `0x0B` returns an ordinary
success reply, and `pt_production_mode_orchestrate` waits one second and invokes
`audio_ble_radio_ready_44b0ae` after the reply. The Case UART manager invokes
that deferred handler after restarting its UART. This is an application path,
so it is useful only if that dispatcher still runs. The checksum-protected
request is exactly `0b 00 00 00 8d`.

`scripts/g2_app_reset_control.py` derives a 2,952-byte Case SRAM bridge from
the reviewed observed-charging bridge. It changes exactly six pinned Thumb
`CMP` immediates: two select `0x0B` instead of `0x24`, and four remove the
OTA `0x52`–`0x55` matches. SHA-256 is
`71da2a7283ce6200d5c38935b1dd619ac27a1884d87b1e520e621c5046e0bb02`.
Its host accepts only the one fixed request, retries only a pre-transmit
setup-status-3 phase, and never replays a request after an uncertain reply.
Four focused tests pass. The emitted Thumb validator was executed under
Unicorn: it accepts the exact reset request and rejects the version request,
OTA START and a short reset request. The secondary pair was then tested while
both contacts were seated. One fixed request per route reached the Case relay;
neither route returned the exact application acknowledgement. The left and
right bridges restored their captured YHM baselines, and fresh postflight
confirmed stock Case 1.2.57. Three transient right setup-status-3 attempts lack
individual route-restoration proof, so the run's outcome remains
`case-route-restore-unverified` despite the final stock Case check. No Apollo
reset was verified and no firmware image bytes were sent. Audit:
`work/usb-stock-recovery-20261104/goal/secondary-product-0b-reset-20261111-v1.json`
(SHA-256 `511507b8116a83880cc6fbfa22a673f3e1c4c0fce68aa35eb585177c56b2eea3`).
The stock 2.2.6.10 handler instructions at `0x00572BA0` were also executed from
the pinned official Apollo image in Unicorn. With the exact request they
returned `0b01030100`, matching the expected success response body. The native
deferred handler at `0x0056F92C` then reached `delay(1000)` and the system-reset
wrapper at `0x0044B0AE` in that order. These two external callees were stubbed;
live UART delivery and physical Apollo reset remain unverified. Audit:
`work/usb-stock-recovery-20261104/goal/stock-2.2.6.10-product-0b-native-audit-20261111-v2.json`
(SHA-256 `eccfcfec55f4bc946f8e92aedfd06e5abba672532fbfdfb056eaa61d8553b188`).

The seated reset and fixed `0x0B` host controllers now retain the strict
`bridge_failure_evidence` from constructor failures. In particular, a Case
setup-status-3 stop can prove zero YHM writes, retained proof clearing and
stock Case restoration even though its `restored` buffer is zero because no
route selection happened. Nine focused controller tests pass. A fresh
secondary-pair read-only run observed three such right-route zero-write stops,
then one routed version timeout; each cleanup was proven and stock 1.2.57 was
confirmed after both sides. Neither temple returned a version. Audit:
`work/usb-stock-recovery-20261104/goal/seated-secondary-readonly-restoration-proof-20261111-v1.json`
(SHA-256 `6404be9bfbd4b0d44e4f4f212738aeaa98fa6a9106d991e8987b6d8824bde1f1`).

The fixed application reset request was also run against native product-test
handler instructions from three hash-pinned stock Apollo components. The
handler prefix was unique in each image; 2.2.6.10 (`0x572ba0`), 2.3.2.14
(`0x59c64c`), and 2.4.0.24 (`0x48caac`) each returned the exact
`0b01030100` acknowledgement for `0b0000008d`. Their respective native
deferred handlers also reached a `delay(1000)` call followed by a wrapper
whose callee writes the `SYSRESETREQ` key `0x05FA0004` to SCB `AIRCR`
(`0xE000ED0C`). The executable audit is `scripts/audit_g2_app_reset_stock_versions.py`;
its report is
`work/usb-stock-recovery-20261104/goal/stock-product-0b-handler-versions-20261111-v3.json`.
The two external callees were stubbed in emulation.
The original pair's installed version is unknown, and no live temple delivery
or physical Apollo reset follows from these offline handler results. Fresh
stock Case preflight reported the secondary pair removed. The prepared empty
Case right 115200 control then ran the stock PB9 train and 20 fixed HELLOs.
The Case counted 160 received bytes; only the final 128 were retained, and
those 128 were 16 HELLO echoes. UART error mask was zero
and no CRC-valid SBL STATUS appeared. The bridge restored its exact YHM
baseline and stock Case 1.2.57 returned. This distinguishes the earlier
secondary-seated right framing error from an empty-Case baseline, but does not
identify its cause or prove temple TX. Audit:
`work/usb-stock-recovery-20261104/goal/reset-early-empty-right-115200-control-20261111-v1.json`
(SHA-256 `2068d84f8b47c1eb663d203fc8ca9290ab99867f33df79481aabff700a61d3cc`).
The original pair was subsequently seated for the bilateral software probes below.

### Original pair seated software controls (2026-11-11)

With both original contacts detected, a fresh read-only application-version
query timed out on both sides. The fixed product-test `0x0B` request was then
handed to each Case relay route exactly once; neither temple acknowledged it.
The separate stock `DEB0` command confirmed a Case-side reset, but subsequent
version queries still timed out bilaterally. Each run restored its Case route
and confirmed stock Case `1.2.57` afterward. The `0x0B` timeouts do not prove
temple delivery or a physical Apollo reset.

Four early-armed stock PB9/HELLO probes followed, one per original route and
baud (left/right at 115200/1000000). Each completed 103 traced reset actions,
sent 20 HELLOs, counted 160 received bytes, restored the exact YHM baseline,
and restored stock Case `1.2.57`. The retained final 128 bytes in each run
were 16 HELLO echoes, matching the empty-Case control. The first 32 bytes of
each run were not retained; the Case's rolling 96-byte CRC search still found
no valid SBL STATUS throughout each run. UART error mask was zero. This does
not establish an Apollo reset, temple TX activity, or retail wired-recovery
provisioning. No firmware image bytes were sent.

After more than the operator-reported 18-minute dead-to-full interval, a fresh
read-only seated query still timed out on both sides with stock Case and both
contacts confirmed. Two separate schema-5 native Case UART controls then sent
the fixed five-byte application version query at 1 Mbaud, one side each. Each
retained only its own five-byte echo (`24000000a6` left, `24000100a7` right),
with no application version frame, no UART errors, exact YHM restoration and
stock Case restoration. An in-Case Bluetooth scan found only the R1; the
advertisement policy while seated is unknown. Consolidated audit:
`work/usb-stock-recovery-20261104/goal/original-seated-software-recovery-audit-20261111-v2.json`
(SHA-256 `65cc4bfd2a3e8b83f2826bd4696905e6b9e0bb2439f8c634ee69381d6d530984`).

### W16 stock Case output-disable window (2026-11-11)

The reconstructed stock destination-2 `0x3F` handler sets Case output flag
`0x20000891`, acknowledges, and on enable applies the YHM output setup. The
Case's periodic status line uses `******` when that flag is one and `xxxxxx`
when zero. Its separate `chEn` field reads another byte and cannot certify
physical output voltage. `scripts/g2_case_output_window.py` sends only the
fixed off/on frames, holds the disabled flag for 35 seconds, and re-enables in
`finally`; three focused tests passed. The first attempt stopped before any
output command because the initial detailed status was delayed. A second
attempt issued off then on but used `chEn` as the wrong proof field. The final
attempt observed a checksum-valid Case ACK and `xxxxxx` status for off, then
another ACK and `******` for on. The Case remained stock `1.2.57`, both
contacts present, and the USB port closed. Two 10-second BLE scans during the
window found only the R1; afterward both original temples still timed out on
read-only wired versions. The Case output *flag* transition is verified, but
no pogo voltage, Apollo reset, or actual outside-Case state was measured.
Native stock Case analysis narrows this boundary: `0x08000FA2` stores
the flag, and periodic policy function `0x08009A14` consumes it when choosing
YHM register 3 and 4 values. For a present, uninhibited side, flag 1 permits
`0xAF`; flag 0 selects `0xAE`. The cached command reaches the YHM bus-write
path at `0x080099E8 -> 0x08009108 -> 0x08000610`. Thus the flag is part of a
YHM hardware-control path in the stock code. Native/source
audit:
`work/usb-stock-recovery-20261104/goal/case-output-flag-yhm-native-audit-20261111-v1.json`
(SHA-256 `e6f09d1dc02cbc43c7a5f7738aea364a753f4aff901694e46400763caa364bb5`).
The stock `DEAA` command reads YHM registers directly and then prints the
Case's shadow cache. A bounded, automatic-restore probe ran twice with the
original pair seated. The first run measured `AF/AF → AE/AE → AF/AF` in
hardware registers 3/4, but its late status check reported flag 1 and caused
the script to label the run failed despite a contemporaneous `xxxxxx` line
bracketing the off readback. The second run bound output flag and YHM readback
in the same serial capture: before `AF/AF`, under flag 0 `AE/AE`, after flag 1
`AF/AF`. Hardware register 1 changed `0x11 → 0x00 → 0x11` in both runs; the
shadow of register 1 remained `0x00`. The second run finished with stock Case
`1.2.57`, both contacts, inactive OTA and a closed USB port. No Case flash,
SRAM, temple command or image byte was used. This confirms live YHM register
control through the stock Case. The chip's register-to-contact electrical
semantics, delivered pogo voltage, and Apollo reset remain unmeasured. Probe:
`scripts/g2_case_yhm_output_probe.py`; successful hardware audit:
`work/usb-stock-recovery-20261104/goal/original-case-yhm-output-20261111-v2.json`
(SHA-256 `3f4473e70c8d2fbcf244c9f16b8dce76f17a01c58c37919317595afa8d962423`).
A subsequent fixed, read-only version request timed out on both original
temples. Case preflight still reported stock `1.2.57`, both contacts, and
`otaGls:0`; the USB port closed. This YHM transition did not restore a
responsive application endpoint:
`work/usb-stock-recovery-20261104/goal/original-after-yhm-output-readonly-20261111-v1/audit.json`
(SHA-256 `afdbbf0c8d84c2ab52a3db7a6514b0b0995846c5a9f8e1594ead3d6a918073fa`).
Hardware audit:
`work/usb-stock-recovery-20261104/goal/original-case-output-window-20261111-v3.json`
(SHA-256 `d084f3552e533ff74c6ce1bcf67a6cef4502183127b24a28e2e2d51dc3b11a70`).
Post-window version audit:
`work/usb-stock-recovery-20261104/goal/original-after-output-window-readonly-20261111-v1.json`
(SHA-256 `e1dee1c9496b6511142821cc9c44f2c354ef8572c10820ed6dc7826ac9651a0f`).
The combined output, two BLE scans, and post-window query are pinned in
`work/usb-stock-recovery-20261104/goal/original-case-output-window-summary-20261111-v1.json`
(SHA-256 `967bf56780455b5232a700b7b4d941470ae478c10e86fc6848b7e64b942c386f`).

### W17 stock Case glasses-OTA routing (2026-11-11)

OpenCFW's reconstructed destination-2 `0x56` handler selects left or right
glasses OTA state, while its exit branch clears that state. This is a distinct
stock Case route from the ordinary version path. The policy source also has
side-specific YHM preparation sequences using register `3` or `4` value
`0xA6` and register `7` value `3` or `5`; the Case did not expose direct
electrical evidence of those transitions during this run. The new bounded
`scripts/g2_case_ota_route_probe.py` entered each route, sent only the fixed
application version query, exited each route, and checked the Case afterward.
Both entries and exits printed the expected stock Case logs. The left version
window contained only `clear led\r\n`; the right window contained zero bytes.
Neither contained a checksum-valid temple version. The final Case preflight
confirmed stock `1.2.57`, both contacts, `otaGls:0`, and a closed USB port.
An ordinary bilateral stock version recheck afterward timed out on both
sides. There were no Case flash or temple firmware image bytes. The `0x56`
entry and Case routing state are proven; temple receipt, a hardware reset, or
an SBL entry is not. Hardware audit:
`work/usb-stock-recovery-20261104/goal/original-case-ota-route-20261111-v1.json`
(SHA-256 `f8587fad94f1084e49d77adc21a014c1fd8e8c83855182a8352039a8714f42f1`).
Post-route stock version audit:
`work/usb-stock-recovery-20261104/goal/original-after-ota-route-readonly-20261111-v1/audit.json`
(SHA-256 `199e43c4a75558b0e2f1b9bd0dee603dfdfa298fc71dc2a4ab3d9fc39dfdfddf`).

The stock `0x14` Case reply reads PMIC temperature, current and a timer-derived
quantity. It has no pogo-voltage sample, so it cannot resolve W16's physical
output question. OpenCFW's reconstructed Case charge policy uses a separate
ADC path for contact sensing. An already compiled and modeled
`case_sensing_bridge/v2` contact variant had previously run on this Case. I
ran that same validated payload with the original pair seated. All ten
left/right phases completed with exact YHM baseline restoration, stock Case
`1.2.57` afterward, and no temple bytes. The five primary raw-count means
were left `[50,50,50,50,50]` and right `[53,52,52,52,51]`; all ten fallback
phases returned 48 or 49. This establishes that the Case's contact-sense
path can see both sides under its diagnostic bias, with no large present
left/right asymmetry. The counts are not calibrated delivered pogo voltage,
charging current, or Apollo power/reset evidence. The SRAM bridge resets
the Case, so it cannot directly measure the earlier volatile `0x3F` off
window. Audit:
`work/usb-stock-recovery-20261104/goal/original-contact-sensing-20261111-v1.json`
(SHA-256 `8c16d0bb2469e5f5f575c0b3123de38248c58c3dfa48aa9229dcd7e8cabdb92a`).

### W18 seated output-off reset and output-on (2026-11-11)

`scripts/g2_case_off_reset_on_probe.py` used stock controls only. With both
original temples seated, `DEAA` read YHM registers 3/4 as `AF/AF`, then
`AE/AE` under stock output flag 0. The Case accepted one `DEB0` and printed
`reset gls L & R, reason: cmd`; a later read while output remained off still
found `AE/AE`. The cleanup `0x3F` request returned the live registers to
`AF/AF`; stock 1.2.57, both contacts, OTA idle and a closed USB port followed.
Read-only left and right version routes still yielded no application frame.
The right route initially encountered three transient non-allowlisted YHM
charge-phase snapshots, then reached the allowed idle baseline and timed out;
the bridge restored its selected route. This establishes software reset and
Case output-control ordering, not physical Apollo reset or power removal.
Two offline cleanup fixtures exercised the confirmed and missing-DEB0 paths.
Hardware audit: `work/usb-stock-recovery-20261104/goal/original-case-off-reset-on-20261111-v1.json`
(SHA-256 `6c10fd6a82eac24ce7d6708b20cd7efa11eff1dfa21b52483850e560d284655e`).

### W19 seated custom Case output-edge capture (2026-11-11)

`scripts/case_output_edge_capture/` builds a two-page temporary Case hook at
the exact stock PB9 reset call sites. After stock `0x3F` turns output off and
`DEAA` confirms `AE/AE`, the hook arms 1-Mbaud RX and raw PB9 sampling before
calling the stock YHM setter on the selected side in `AE → AF → AE` order. It
keeps first-byte retention, samples for 3,000 off-state SysTick wraps, 9,000
on-state wraps, and 3,000 after the stock PB9 pulse, then restores UART/GPIO.
Off-state framing/overrun noise is recorded separately and discarded before
the edge. The capture is read from Case SRAM through ROM before the transaction
restores both original flash pages, the original 32 KiB SRAM snapshot, and the
stock Case application. Stock output is checked afterward by status and live
`DEAA` register readback. The hook sends zero temple command or image bytes.

The v1 native hook passed eight compiled Unicorn fixtures and its exact writer
passed 27 controller cases. A first live attempt stopped before reading SRAM
when a post-hook output-on acknowledgement was absent; its transaction restored
exact Case flash/SRAM and stock output. The next run retained a one-byte
`0x00` with UART framing/overrun mask `0xA` in the first off-state poll and
stopped with status 11 before issuing `AF`; it too restored stock. This matched
the earlier AE/AF charger-cycle invalid-byte pattern. The revised hook
quarantines off-state noise and continues receiving after the edge. Its build
passed nine compiled Unicorn fixtures, including that noise and a later boot
marker; the exact writer passed 27 cases. A fresh live mode-2 staging trial
confirmed zero erase/program operations on both pages, unchanged Case flash,
restored original SRAM, and stock 1.2.57. Build manifest:
`work/usb-stock-recovery-20261104/goal/case-output-edge-capture-build-v2/validated-manifest.json`
(SHA-256 `8a9f2edd77f0988cd12ef83ddca22de7f21577e8dd3078a455ebb2589e23d047`);
staging audit:
`work/usb-stock-recovery-20261104/goal/case-output-edge-capture-stager-qualification-v2/audit.json`
(SHA-256 `cac8f50c80bfe3fbeaab095c9494aa95ecf1de75638a7baaaa7f06ff15076d68`).

With the original pair continuously seated, left and right live runs each
completed 12,000 pre-pulse and 3,000 post-pulse SysTick wraps. Both reported
status 0, the `AE → AF → AE` setter sequence, 15,000 receive wraps, no raw
PB9 transitions in more than ten million combined samples per side, and just
one retained `0x00` with UART error mask `0xA`. Neither contained an Even
bootloader marker or CRC-valid STATUS. In each trial the original Case pages,
mirrors and SRAM restored exactly; stock 1.2.57 rebooted; status flag 1 and
live YHM `AF/AF` verified output policy restored. Left audit:
`work/usb-stock-recovery-20261104/goal/case-output-edge-capture-original-left-v3/audit.json`
(SHA-256 `82729adc5be0dcb170b1814a25bccbca981e08640f24ce93c45f8dbb0a7eda60`);
right audit:
`work/usb-stock-recovery-20261104/goal/case-output-edge-capture-original-right-v1/audit.json`
(SHA-256 `0197c78659eab403bbd77c7c669a201ff8a7be327a539ed8e4693302811f9247`).

The flags and native setter path establish a Case YHM bus command, while the
emulator proves only the compiled hook's behavior in its explicit fixtures.
Neither result measures voltage at the temple pads, an Apollo power/reset
transition, or the retail boot-override configuration. Static PB9 is a Case
input observation; the invalid `0x00` is not an authenticated temple byte.
An unchanged repeat of this specific edge/capture sequence would not resolve
those missing physical and provisioning facts.

A post-restoration read-only bilateral version check again received no temple
frame. Both route bridges restored their YHM baselines; fresh stock telemetry
reported Case 1.2.57, both contacts and `otaGls:0`. Audit:
`work/usb-stock-recovery-20261104/goal/original-after-output-edge-readonly-20261111-v1.json`
(SHA-256 `3be9b27ffaf12fde9293a6d16091a4b0e2530a14c97b55ec27c19dbb8d29dd8f`).
The stock off/reset/on sequence, schema-16 build/staging, bilateral capture,
and postflight are pinned together in
`work/usb-stock-recovery-20261104/goal/original-output-edge-summary-20261111-v1.json`
(SHA-256 `e480c9076bfa5f9b19131f8994e53db16c45ff394b0220391d43c98c7d3078e3`).

### D04 same-channel Case ADC response to YHM AF/AE (2026-11-11)

`scripts/case_output_sensing_bridge/` is a separate SRAM-only Case diagnostic.
It alternates `AF` and `AE` for each side while retaining that side's same
YHM selector (`0x85` left, `0x87` right) and STM32 ADC channel 4. It records
eight raw conversions per phase and the trimmed mean, checks ten YHM registers
after selection, and restores the entire exact ten-register baseline after
each phase. It does not send a temple command or write Case flash. Its
1,522-byte compiled payload passed twelve executed Unicorn fault cases,
including ADC readiness, conversion, register-read and restoration failures.
Build manifest:
`work/usb-stock-recovery-20261104/goal/case-output-sensing-differential-build-v1/validated-manifest.json`
(SHA-256 `63ae4eafc4bf0a583ddd8fdb46156e3e4cc75f62944c17abf64c4b857a56c65c`).

With the original pair reported seated, the live Case completed all ten
phases with status 0, no ADC error, and baseline/restored YHM image both
`811104afaf03812033ff`. With fixed selector per side, left `AF` trimmed
means were `[71,72,71]` raw counts and left `AE` `[54,53]`; right `AF`
`[71,71,71]` and right `AE` `[52,52]`. This repeatable 17–19 count change
proves the Case's internal contact-sense signal responds to the YHM output
setting. It does not calibrate the ADC path to pad voltage or current, prove
that a temple loses battery power, or establish an Apollo reset. Stock Case
1.2.57 restored; a subsequent read-only check again timed out bilaterally
and restored both route baselines. Sensing audit:
`work/usb-stock-recovery-20261104/goal/original-output-sensing-differential-20261111-v1.json`
(SHA-256 `87843d9fff2e757e3fb71e99747dba128513b5fb9c9baab13aa400845890e46f`);
postflight:
`work/usb-stock-recovery-20261104/goal/original-after-output-sensing-readonly-20261111-v1.json`
(SHA-256 `2bb8a187a7dc99e375b3f74b282e259e3143f334310994a17c2b71722f855519`).

### W20 seated off-state native reset and output-on receiver (2026-11-11)

`scripts/case_output_off_reset_capture/` is a separate schema-16 Case hook,
not a mutation of the W19 pinned source. It arms UART2 RX and raw Case PB9
sampling before calling the exact stock reset primitive while the selected YHM
output is `AE`. After 3,000 SysTick wraps it calls that primitive in the
stock task context, then sets that output to `AF` and captures for 12,000 more
wraps. This is the untested W18/W19 timing combination. It sends no temple
bytes. The audit's `insertionWaitSystickWraps=12000` field is a legacy name
for the cumulative count before the second capture stage; the native reset
actually occurs at wrap 3,000. The `postPulseCaptureSystickWraps=12000` value
and compiled source define the timing.

The 1,908-byte hook passed nine executed Unicorn cases, including an ordering
assertion that the native pulse precedes `AF`. The exact Case page writer
passed 27 controller cases. Live mode-2 staging verified both original pages
without erase/program, restored the original SRAM and stock Case 1.2.57.
The original pair remained seated for both live runs. Left and right each
completed status 0 and 15,000 receive wraps. PB9 stayed high with zero
transitions across more than ten million samples per route. Each retained only
`00` with UART error mask `0xA`, no Even bootloader marker. The probe did not
send SBL HELLO, so these passive results do not rule out a listener that needs
a prompt. Each transaction verified exact original Case pages and mirrors,
32 KiB SRAM, stock 1.2.57, output flag 1 and YHM `AF/AF` afterward.

A subsequent stock read-only query timed out on both application routes; fresh
Case telemetry found both contacts present and `otaGls:0`. No CRC-valid SBL
STATUS or stock image transfer occurred. The summary binds the build, staging,
both captures and postflight:
`work/usb-stock-recovery-20261104/goal/original-off-reset-output-capture-summary-20261111-v1.json`
(SHA-256 `835d8d942162e9e5e1fb26adf35a5cb29fe68e2e9ccfd91a0a98fbbcce0ed689`).
The source-supported next experiment is a bounded SBL HELLO sent during this
specific off-state-reset-to-`AF` interval, with reply authentication before
any firmware write. Retail INFO0/INFOC settings and a physical Apollo reset
are still unknown.

### W21 seated off-state reset with fixed SBL HELLO (2026-11-11)

`scripts/case_output_off_reset_sbl_hello/` extends the W20 timing in a separate
schema-17 artifact. It calls the stock reset primitive while the selected YHM
output is `AE`; after setting `AF`, it sends only the fixed Ambiq SBL HELLO
`14 55 9d e9 00 00 08 00`, twenty times over the receive window. It retains
all first UART bytes and Case PB9 transitions and accepts only CRC-valid
96-byte SBL STATUS frames as positive bootloader evidence. No image or
provisioning command exists in this hook. The 2,048-byte compiled payload
passed eleven executed Unicorn scenarios, including exact transmit bytes,
CRC-valid STATUS acceptance and corrupt STATUS rejection. Its exact page writer
passed 27 controller cases. Live mode-2 staging wrote no Case flash and
restored SRAM and stock 1.2.57 before the experiment.

Both original routes completed the 15,000-wrap hook with status 0 and exactly
160 transmitted bytes each. Each retained `00` with UART error mask `0xA`,
then 20 byte-exact HELLO copies. Each showed 326 PB9 transitions after the
pulse. These prove transmit and receive activity at the Case; the source of
the copies is unassigned. Neither route returned a CRC-valid SBL
STATUS or an Even bootloader marker. The physical Apollo reset and retail
INFO0/INFOC wired policy remain unknown. Both application-version routes also
timed out afterward.

The left Case transaction restored all original pages, mirrors, SRAM, stock
1.2.57 and output. The right hook and capture qualified, but its first cleanup
failed the second-page writer result checksum/schema/phase check after the
first page had restored. A separate restore-only invocation then verified the
remaining original page and full stock Case code/mirrors, saved 32 KiB SRAM,
stock 1.2.57, output flag 1, and YHM `AF/AF`. The final read-only pre/postflight
found both contacts and `otaGls:0`. This transient partial-restore fault remains
a material risk for temporary Case firmware work. The later guarded runner adds
an automatic restore-only retry; the underlying fault cause remains unproven.
The failed transaction also recorded one earlier ROM read timeout during mirror
verification that succeeded on retry. The two errors cannot be causally linked
from current evidence. Fault audit:
`work/usb-stock-recovery-20261104/goal/right-case-restore-transient-fault-analysis-20261111-v1.json`
(SHA-256 `ebc7bdfb33ae2de8875bc3588ad57a51062bbbbc81e5de742ec68edf1e9aaf21`).
The original glasses remain unrecovered and no firmware image byte was sent.

Bound audit:
`work/usb-stock-recovery-20261104/goal/original-off-reset-sbl-hello-summary-20261111-v1.json`
(SHA-256 `d882c91887888940e96a6f0cf723b1299c76ba8288f73849f8b9290916635174`).

### W22 seated off-state SBL HELLO at 115200 baud (2026-11-11)

`case_output_off_reset_sbl_hello_115200/` is a separately hash-pinned
schema-18 build of the W21 fixed-HELLO timing with STM32 UART2 BRR 556
(115200 nominal) instead of BRR 64 (1 Mbaud). Its 2,052-byte compiled hook
passed eleven executed Unicorn cases, including CRC-valid STATUS and corrupt
STATUS fixtures. The exact writer passed 27 controller cases; a live mode-2
staging audit performed zero Case flash operations and restored the original
SRAM and stock 1.2.57.

`guarded_case_capture.py` supervised both original-pair live routes. It checks
original SRAM and mirror backup hashes and, if the capture runner reports
unverified Case cleanup, invokes restore-only mode without repeating the
temple probe. Three fault-path unit tests pass, including a first failed
restore followed by a successful second restore. The earlier W21 partial
restore audit dry run selects the correct restore-only command. This wrapper
does not itself alter the fixed two-second wait in the page writer; it makes
failed cleanup recoverable and observable. The W21 fault remains unexplained.

Both 115200 routes completed status 0, sent exactly twenty eight-byte HELLOs,
and retained one UART error-marked `00` followed by twenty byte-exact HELLO
copies. Case PB9 recorded 760 post-reset transitions per route, consistent
with the slower Case UART transmission. Neither route had a CRC-valid SBL
STATUS or Even bootloader marker. Both guarded transactions verified original
Case pages/mirrors, 32 KiB SRAM, stock 1.2.57, output flag 1 and YHM `AF/AF`.
The final read-only check found both original contacts present, `otaGls:0`,
and no application-version reply from either temple. No glasses firmware image
byte was sent. Bound summary:
`work/usb-stock-recovery-20261104/goal/original-off-reset-sbl-hello-115200-summary-20261111-v1.json`
(SHA-256 `16e99f06af73d5d82cec321dc7d530e594c369a1b1f68bc8fe861916cf33d7ac`).

These two baud trials resolve the specific off-state-reset plus fixed-HELLO
window on the Case route. Exact HELLO copies show Case RX activity with source
unassigned; they do not show that an Apollo pin received HELLO or reset. A new UART timing repeat would
not discriminate retail INFO0/INFOC configuration or physical reset coupling.

The earlier qualified empty-Case right 115200 control transmitted 160 HELLO
bytes, counted 160 RX bytes and retained sixteen exact HELLO copies. Its
preflight confirmed both contacts absent. Each seated W22 route retained a
leading error-marked `00` followed by twenty exact copies; its last 128 bytes
equal the empty-Case control's retained 128 bytes. This demonstrates that exact
copies can arise with no glasses present. The control used a different Case
program and timing, so it does not locate the electrical echo source or prove
that every seated byte had that source. Comparison:
`work/usb-stock-recovery-20261104/goal/empty-case-vs-w22-hello-control-20261111-v1.json`
(SHA-256 `a735684a1730542206e4207ad33f0cea08d63fdc3ddcc9d63c3839bfa03a1f3f`).

A 12-second read-only BLE scan after W22 found a nearby Even R1 advertisement
and no G2 advertisement in that window. This is a time-bounded negative scan,
not proof that either original temple cannot boot or advertise later. Evidence:
`/Users/kalani/Repo/SybilSight/docs/bluetooth-profiler/sessions/2026-11-11T22-55-50Z-scan.json`.

### D05 Bluetooth observation across a seated Case reset (2026-11-11)

A delayed stock `DEB0` reset ran while a separate 45-second Bluetooth scan was
already active. The reset call was fully inside the scan window, with 16.76
seconds of scan before it and 15.00 seconds after it. The Case confirmed its
reset command. Both contacts remained present, both application-version routes
timed out, both Case relay baselines restored exactly, and the Case returned to
stock 1.2.57 with `otaGls:0`. No Case flash or glasses image bytes were written.

The scan recorded 76 advertisement records, including an Even R1, but no
advertisement named G2 and none with the `ERS211` manufacturer-data prefix
seen in earlier stock G2 scans. Eleven connectable advertisements had no name;
none can be assigned to the original pair. The absence of an identified G2
advertisement in this window does not prove Apollo reset, lack of boot, or
absence of a differently advertised recovery endpoint. The initial attempted
scan ended immediately before the reset began, so only the corrected timed run
is used for this comparison. Bound evidence:
`work/usb-stock-recovery-20261104/goal/original-case-reset-overlapping-ble-summary-20261111-v1.json`
(SHA-256 `66c9cbdf9978d2a97904b13eed602099bb1287bbef174a9180286ac925f515f6`).

### Latest stock Even bootloader receive boundary (2026-11-11)

The official 2.4.0.24 bundle contains Case version `1.2.57`, the same version
restored after the live probes. Its bootloader component was wrapped for static
analysis and extracted byte-for-byte afterward; the extracted SHA-256 matches
the official component (`ecb91896234392e2b98ec80b1ac3ebf4aa27726d3cbed10927edf0b44d83d665`).
Ghidra decompiled the newer manager's OTA decision at `0x0042e57c`: it reads
`0x007fe000` and selects installation only for `0x55555555`. The manager task
at `0x0042e650` chooses that install event or application handoff. The DFU task
at `0x0042e1b0` opens `ota/s200_firmware_ota.bin` and reads its header from
storage. These traced functions contain no pogo firmware receiver or Case
command that stages the file or sets the flag. The comparator 2.3.2.14 and
2.4.0.24 components retain the same installer markers, and 141,442 of the
newer's 149,773 bytes lie in exact 32-byte windows found in the older image.

This closes only a proposed *new receive route in those traced latest-stock
functions*. Static similarity cannot exclude another receiver elsewhere, and
the original pair's installed bootloader and failed application image remain
unknown. The Case port was not opened and no device byte was written for this
audit. Summary and decompiler evidence:
`work/usb-stock-recovery-20261104/goal/stock-2.4.0.24-bootloader-wired-boundary-20261111-v1.json`
(SHA-256 `945d012eee3a2ec953e51fec7831acd442cc8c55008838fccb617339c8f1f3c8`).

The 2.4.0.24 bootloader's separate `boot_count` function at `0x00421568` was
also decompiled from a Thumb-marked ELF whose extracted bytes match that exact
official component. After mounting LittleFS, it opens the `boot_count` file,
reads a four-byte value, increments, rewrites and logs it. That function has no
count comparison or fallback branch. The component has one direct pointer to
the `boot_count` string and one to its log string. This does not prove that all
possible bootloader fallback logic is absent, nor does it identify the version
installed on the original pair, but it removes the proposed reset-count loop
as a source-supported action. No live reset or device write occurred. Audit:
`work/usb-stock-recovery-20261104/goal/stock-2.4.0.24-bootcount-fallback-boundary-20261111-v1.json`
(SHA-256 `48381e3b6b934b8435868637f9bfd717e8e869bb0a99f1bbdaa77b98498f0f4b`).

### Public board photographs and seated-contact check (2026-11-11)

The six-page [FCC G2 internal-photo filing](https://fccid.io/2BFKR-G2/Internal-Photos/Internal-photos-8787893)
was downloaded and verified against its published SHA-256
`9f8f3d4455013a4961198b5436a35d9c400225ad5a714ce5b32fb58419b31081`.
All pages were visually inspected. They show the disassembled temple boards and
contacts but do not label or trace a charging contact to an Apollo reset or
boot-override input. The filing lists schematics only as metadata. This is a
limit of the available photographs, not evidence that such a connection is
absent. Photo audit:
`work/usb-stock-recovery-20261104/goal/public-g2-photo-reset-boundary-20261111-v1.json`
(SHA-256 `2405c4a16301d4c8a64ecc71683df90a6e1b612fbac723efd299b8e1f70471df`).

A bounded stock-Case read-only loop then left the original pair seated and
issued 24 fixed bilateral version requests over 90 seconds. Exact Case
preflight and postflight reported both contacts present, stock `1.2.57`, and
inactive OTA; no checksum-valid temple version frame arrived. The USB port
closed. The operator later confirmed pressing both seated temple ends for about
15 seconds inside the 23:28:15–23:29:45 UTC probe window. Pressure therefore
did not restore an **application-level** version reply during that test. A
failed firmware image could explain that silence despite sound contacts; this
result says nothing decisive about bootloader access. No reset, Case flash or
firmware-image write occurred.
Capture:
`work/usb-stock-recovery-20261104/goal/original-contact-pressure-control-20261111-v1/audit.json`
(SHA-256 `f3589183d692e956dfb93c9629810be3af364486bfbb7a08e6c6023c817afb87`).

### D06 Seated post-transmit PB9 edge matrix (2026-11-11)

`scripts/case_sbl_quiet_edge` adds a volatile Case SRAM probe that runs the
pinned stock PB9 reset train and sends twenty fixed Ambiq SBL HELLO requests.
After each UART transmit-complete flag, it disables Case transmit and separately
counts PB9 input samples, transitions, low samples, and UART bytes during the
400 ms receive interval. It was compiled and executed under 32 fault and
response models for each route and baud, including simulated quiet-window
edges. The host required two complete exact Case-code readbacks and a CRC-valid
Case readiness acknowledgement before each live launch.

The original pair was operator-reported seated throughout; all four live
preflights confirmed both contacts present and inactive OTA. Left and right
routes were tested at 115200 and 1,000,000 baud. Each completed the stock train,
twenty HELLOs, 160 transmitted bytes, 160 total UART receive bytes, and
5,563,920 post-transmit PB9 samples. Every receive-only PB9 sample was high:
zero transitions and zero low samples. The retained 128-byte ring in each run
contains sixteen exact HELLO copies. The first 32 UART bytes were not retained,
and a few bytes reached the UART FIFO after transmit-complete; those could be
buffered self echo and are not a temple reply. No CRC-valid SBL STATUS was
captured. All four runs restored YHM/GPIO state and stock Case `1.2.57`; no Case
flash or temple firmware image byte was written.

This narrows a wrong-UART-baud explanation for the tested fixed HELLO paths,
but does not establish that the Case waveform resets Apollo or that the
original pair's INFO0/INFOC settings enable wired SBL recovery on these pins.
It does not turn application-version silence into a contact diagnosis. Combined
audit: `work/usb-stock-recovery-20261104/goal/original-quiet-edge-matrix-20261111-v1.json`
(SHA-256 `d395b1ed8735832a99c9f915d54cfadec863a4c2ccf374ad0e2f27de9c70cb0d`).

The community `g2-bootloader-patch` README explicitly states that stock G2
provisioning does not expose debugging or firmware update access on the pogo
pins and that its UART2 RAM loader must be installed first through a responsive
application. That is the patch author's claim about stock hardware, not a
readback of this original pair's INFO0/INFOC words. The local search found no
verified record that this original pair received the patch before its failed
update; the experimental image tied to `4FB39E` belongs to the secondary pair.

A subsequent stock-only bilateral version query still found both contacts
present with inactive OTA and no checksum-valid application version frame. Its
USB port closed. Post-check:
`work/usb-stock-recovery-20261104/goal/original-after-quiet-edge-matrix-readonly-20261111-v1/audit.json`
(SHA-256 `1023c307b450834b47f1d0b316aa02923f6f0e1041489323893b224863f5cb61`).

### Stock Even UART2 startup and shutdown (2026-11-11)

The absence of an application version reply on the original pair is expected
after its failed flash. It is not evidence of a bad contact, failed reset, or
bootloader silence. We therefore decoded the stock bootloader's compressed
startup RAM data rather than repeating version queries. A bounded parser in
`scripts/audit_g2_bootloader_uart_rows.py` reproduces the 2.2.6.10 initialized
data SHA-256 already independently recorded by OpenCFW, then audits all 18 local
stock bootloader components. Every component initializes a UART2 row for
GPIO42/44 at 1,000,000 baud with a zero receive callback. The 2.4.0.24 row
begins at RAM `0x20000458` and its receive buffer pointer is `0x20080400`.

In the latest 2.4.0.24 image, `0x41f612` configures the UART rows but calls
`0x41f8ba` for each row after enabling its interrupt. That callee clears the
row's initialized flag and powers the UART down. The later boot startup call
at `0x41b870` powers on row 1 (UART1), not row 2. The UART2 IRQ wrapper at
`0x41f5e6` services row 2 only when its initialized flag is one. The stock
receive routine at `0x41f776` can put FIFO bytes into a RAM buffer, but it
does not provide an active recovery command path in the traced startup state.
Its unchecked count is not evidence of a usable overflow while UART2 is off.
This resolves the earlier apparent contradiction between a UART2 table entry
and the community patch author's description of stock UART2 as inert.

The exact bootloader in the original pair, its dynamic state, and Ambiq SBL
provisioning remain unread. A preinstalled community patch or a distinct SBL
route still requires target-bound evidence. No Case or glasses bytes were sent
for this audit. The parser passed three focused tests. Machine-readable audit:
`work/usb-stock-recovery-20261104/goal/stock-bootloader-uart2-runtime-static-audit-20261111-v1.json`
(SHA-256 `b055516b8bc751c073e05e78614b32f3b54af225c90483adf472386906ddb63b`).

### Ambiq versus Even invalid-image boundary (2026-11-11)

Ambiq's OEM provisioning guide says an enabled SBL UART update can start on a
boot error such as an invalid *SBL main image*, or a configured GPIO override.
Its generic INFO0 example sets the main pointer to `0x410000`. In the two
verified Even stock bundles, `0x410000` holds the Even bootloader; the later
Even application begins at `0x438000`. The 2.4.0.24 Even manager tests only
the update flag at `0x007fe000` before selecting its DFU or application event.
On the application event, the DFU task tests whether the application's first
stack word has an SRAM-shaped top bit and then jumps; it does not validate the
already-installed application CRC on that path. Its update event reads the
pre-staged `ota/s200_firmware_ota.bin` file.

Thus an app-only failed write can leave the SBL's own boot target intact and
still cause a hang or no application reply. It need not invoke Ambiq's
invalid-image recovery. This is an inference from the shipped layout and latest
bootloader flow, not a readback of the original pair. If the original failed
write also damaged its Even bootloader, the SBL error path remains possible,
subject to this pair's unknown provisioning. Ambiq's Apollo510 ERR034 further
means SBL versions before 1.16 use factory INFO1 wired settings for application
or GPIO-initiated recovery even when INFO0 was configured; this original pair's
SBL version and effective settings have not been read. Audit:
`work/usb-stock-recovery-20261104/goal/apollo-even-boot-chain-boundary-20261111-v1.json`
(SHA-256 `eb1421e0dca599e4ddb4c4622c2b23d9d0c7e0d4bc6bd742b71f0333d626d256`).

### Contact pin limits for software-only measurement (2026-11-11)

The decoded stock bootloader UART2 pin row uses Apollo GPIO42/44. Ambiq's
Apollo510B pin table assigns SWDCK/SWDIO to GPIO20/21; GPIO42/44 offer UART,
trace or ordinary GPIO functions but not SWDCK/SWDIO. The Case's STM32G0B1
PB8/PB9 are USART3 TX/RX-capable digital pins with no ADC additional function
in ST's pin table. Changing Case firmware alone therefore does not turn the
mapped pogo pair into ordinary SWD or directly measure contact voltage with
those MCU pins. A separate YHM2510 analog route and the original pair's actual
contact continuity remain unproven. This leaves an externally measured reset
or temple TX signal, or a true original-target SBL/patch response, as the
remaining discriminators. No device action occurred for this pin audit:
`work/usb-stock-recovery-20261104/goal/pogo-debug-analog-pin-boundary-20261111-v1.json`
(SHA-256 `fd64a998314dfc158e3e12b09da648138d9a5a0849365e13285cf1057c9e7632`).

### Experimental older community loader control (2026-11-11)

An isolated worktree at
`/Users/kalani/Repo/g2-bootloader-patch-22610` ports the community
`drdaeman/g2-bootloader-patch` manager and handoff hooks to the exact
2.2.6.10 stock bootloader bytes. The source-pinned builder rejects altered
stock input and hook targets outside its appended code. Its 6,104-byte
patch builds at `0x434900`; the generated image is page-aligned and ends
before the `0x438000` application partition. Four focused tests pass,
including emulated execution of the old manager binding and one-shot
handoff. The original 2.3.2.14 build retained its prior patch SHA, and
29 selected tests passed with one official-bundle-dependent skip.

This is an **offline control artifact**, not a recovery result. No patch
or firmware image was sent to either pair. The secondary left temple
previously reported application firmware 2.2.6.10 but did not advertise
in the fresh scan; its installed bootloader and present health are
unverified. The original pair's installed bootloader version is unknown,
and its failed application cannot be assumed to accept a Bluetooth
patch installer. Neither silent application version replies nor this
offline port prove an original-target bootloader entry.

### Stock Case PMIC sample under output toggle (2026-11-12)

The Case's stock destination-2 opcode `0x14` returned a checksum-valid
11-byte power sample while the original pair remained seated. The Case
preflight identified both contacts, stock 1.2.57 and inactive temple OTA.
An output-on/off/on run requested eight stock `0x14` samples per phase.
The decoded current field was `-9` in every before and off sample; the
first two after samples were `-19`, then six returned to `-9`.
Temperature stayed `29` in this raw response. The Case acknowledged
both output changes, restored output on, closed USB and passed the
same stock postflight. No temple command or firmware byte was sent.

This sample comes from the Case PMIC, not a dedicated pogo ammeter.
Its transient after output-on may reflect a Case charging event, but it
does not identify a temple load, pad voltage or an Apollo reset. The
unchanged before/off median does not establish that output control
failed electrically. Read-only probe:
`work/usb-stock-recovery-20261104/goal/case-stock-power14-readonly-20261112-v1.json`
(SHA-256 `59c72025e67b46bc9ff3ca1d0848de6960d6859be7a9a41dc3f22f515d2e8a01`);
differential:
`work/usb-stock-recovery-20261104/goal/original-case-power14-differential-20261112-v1.json`
(SHA-256 `7809056ab267f35f3686552d3062949fdd389919fb36377a466e21236fa5f0f5`).

The OpenCFW Case reconstruction also clarifies what stock `DEB0` asks
the Case to do. `case_policy_no_reply_reset` selects each YHM side and
invokes `case_policy_reset_pulse`; that leaf toggles Case GPIOB pin 9
through a fixed train. The traced Case sequence has no temple reply
check or application command parser, so the Case can generate its
waveform while the glasses application is broken. This does not prove
that the waveform reaches an Apollo reset input or causes the SBL to
listen on the contact pins.

A one-setup physical capture plan is prepared at
`work/usb-stock-recovery-20261104/goal/jumperless-one-setup-reset-capture-plan-20261112.md`.
It first requires a live Jumperless routing and pad-lead DC check, then
aims to record both pad voltages simultaneously across stock `DEB0`.
Jumperless is currently absent from USB inventory; no physical setup or
pad waveform capture has been performed for that plan.

The host-side synchronized recorder is now implemented at
`scripts/jumperless_reset_audio_capture.py`. It requires a fresh wiring
and breadboard-end DC qualification, exact `JL Audio In` device, two live
audio channels and a completed baseline before it sends one stock `DEB0`.
It records both raw channels, their difference, Case console bytes and
the pre/post Case state. Five focused offline tests passed, including a
missing-audio refusal and a simulated live-audio reset. No live reset
has been performed with this recorder. The published Jumperless example
routes its audio channels to rows 20/40 and enables DC blocking; this
setup instead must route ADC0/ADC1 to the measured temple pad rows
(left 2/1 or right 3/4) with DC blocking off. Row 20 was previously
used for a Case contact, so the example routing would misidentify the
measured endpoint. The actual installed Jumperless audio capability and
crossbar state remain unverified while its USB device is absent.

For the next live setup, a read-only Jumperless device inventory is
prepared at `scripts/jumperless_g2_audio_inventory.py`. Its emulated
fixture confirms it reports bridge and rail state without making a
connection or enabling audio. The published audio mode's 16 kHz sample
rate can show a synchronous pad waveform, but a flat trace cannot
exclude an edge shorter than one sample period or limited by analog
bandwidth. The capture will therefore be positive electrical evidence
only; an absent waveform at this rate is inconclusive.

The Jumperless virtual Case-to-glasses path is resistive: its documented
single-path link is about 80 ohms, and even stacked links are roughly
20–40 ohms. The guarded route generator at
`scripts/jumperless_g2_audio_route.py` therefore defaults to ADC taps
only and requires explicit `--resistive-case-links` for a Case bridge.
Such a bridge can support positive signal evidence, but failure to
charge, reset or return SBL status through it cannot rule out a direct
Case-contact recovery path. Its generated route and restore scripts
compare exact live bridge and rail snapshots before changing anything;
they remain unexecuted while Jumperless USB is absent. Powered Case
contacts must not remain connected to an unpowered Jumperless crossbar.
The host supervisor `scripts/jumperless_g2_capture_supervisor.py`
connects the qualified route, runs one reset capture, and attempts the
generated restore script in `finally` on every path. Its offline tests
cover missing-board refusal and restoration after a capture exception.
No Case-to-glasses virtual route or host audio capture has been run on
the original pair in this new setup.

The previously observed Jumperless firmware string was 5.7.11.5. An
exact-tag source checkout at commit
`8e9a7cdb45db6e99b5ad71d1e75d1ed95bcdcc16` contains the USB audio
setup/status APIs, two-channel 16 kHz default, and a configurable DC
block. Its default DC block is on, so the guarded route generator now
requires live status showing channels 0/1, 16 kHz, 8 V full scale and DC
blocking off. Source audit:
`work/usb-stock-recovery-20261104/goal/jumperless-5.7.11.5-audio-source-audit-20261112.json`.
The past version string does not prove the currently disconnected board
has the same bytes or that audio is enabled; the live read-only inventory
will decide that.
The host configurator `scripts/jumperless_g2_audio_enable.py` now
requests the exact capture mode and waits for a fresh post-enumeration
inventory, unchanged bridges/rails and the `JL Audio In` host device.
A serial timeout during USB re-enumeration is recorded and never counted
as success by itself. Four focused offline tests pass; the configurator
has not run on the disconnected board.
