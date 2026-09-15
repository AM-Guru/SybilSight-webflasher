# CFW 2.2.10.69 — display path efficiency and link review (pre-openCFW migration)

Review date: 2026-09-15. Scope: the g2flash-derived patches (`~/Repo/g2flash/patches` +
`scripts/cfw/overlays/2.2.10.68`) compared against the openCFW recovery of stock
(`~/Repo/evenRealities-openCFW/g2`), with the SybilSight Video Test (Bad Apple, 288×144,
mode-6 keyframe then mode-3 deltas) as the frame-rate bench.

## What the comparison established

- **Stock has no frame clock.** The display-manager thread blocks forever on its queue
  (`display_manager_thread.c:334-339`); a panel refresh happens only when a type-3 message is
  posted (`open_cfw_display_send_reflash`). The 2 s timer posts command 6, which is a panel
  health check that repaints only when the panel reports healthy. The "16 ms LVGL wake" idea
  was wrong: `osDelay(0x10)` exists only in a 24-iteration transition settle loop. So fps is
  bounded by BLE → inflate → present → QSPI, nothing periodic.
- **2M PHY alone buys nothing without DLE.** With 27-byte LL PDUs a connection event carries
  ~6 × 27 B whatever the PHY. `DmConnSetDataLen`/`HciLeSetDataLen` are linked but the only
  caller is the ring link, exactly like `DmSetPhy`. Phone→temple already benefits from the
  central's data length (a ~1 KB delta is acknowledged in ~70–110 ms); temple→phone
  (notifies: mic relay, image ACKs, status) does not — a 237-byte relay notify is nine air
  packets.
- **Per-frame CPU on the temple was small next to that**: inflate window alloc/free per frame
  (34–40 KB through the stock heap), a byte-at-a-time RLE fill (~2 ms worst case per
  keyframe), the shadow→framebuffer word copy (~0.4 ms full frame, dirty-range since .49),
  a full-panel QSPI push every frame (~3–6 ms; the six refresh words are `x,y,?,?,w,h` and
  stock only ever posts `0,0,0,0,576,288`, so a partial rect is left for a later candidate
  once the consumer's word semantics are confirmed from the stock 2.2.10 consumer, not the
  2.2.6.10 recovery).
- **Two stability defects in the patch, not stock**: the display gate wrapper
  `FUN_00479482` returns its saved r7 (`pop {r0,pc}`), so the worker inferred gate ownership
  from `direct_pending` — wrong in both directions (a leaked semaphore stalls every later
  take by 1 s; a false negative lets a delta touch the shadow mid-copy). And `cfw_time_start`
  ran a tick-edge calibration spin (up to 2 × 500 000 iterations) from the display task.
- **Streaming notifies are dropped silently at half queue** (`ble_msgtx_enqueue.c:473-483`
  returns 0 on drop) and one notify is outstanding at a time with a 10 ms retry quantum
  (`ble_wsf_flow.c`): with DLE each relay notify costs one packet instead of nine, which is
  the practical fix; a queue-depth read for back-pressure needs `osMessageQueueGetCount`
  mapped first.

## 2.2.10.69 changes (overlay `scripts/cfw/overlays/2.2.10.69`)

| file | change |
|---|---|
| `zlib_glue.c` | One `z_stream` per session in heap 13 (`ctx->zstrm`); `inflateInit2` once, `inflateReset` (2.2.9.22 `0x5d60eb` → 2.2.10.10 `0x5d8ddb`) per frame, never `inflateEnd`. Failures counted in `zstrm_fail` and the stream rebuilt on the next frame. |
| `zlib_glue.c` | Display gate taken with `xQueueSemaphoreTake(*0x200769e4, 1000)` (`0x442389`, identical in both images) and the frame dropped on timeout (`gate_timeouts`); `direct_pending` no longer used as an ownership proxy. |
| `rle.c` | Word-wise run fill (head bytes, 32-bit stores, tail). Same `left`/`err` accounting. |
| `debug.c` | `cfw_time_start` no longer calibrates; `cfw_time_calibrate()` runs once from the image worker (peek, never allocates). `cfw_time_end` reads the cached value only. |
| `mic_control.c` | `MIC_FLAG_DLE` (bit 5): `HciLeSetDataLen(handle, 251, 2120)` (`0x5410ef` → `0x543997`) with the handle read from the DM connection block (`dmConnCcbById`, `0x4ca71f` → `0x4cca83`, handle u16 at +0xc) — issued on every CONFIGURE and at session start. |
| profile | five reviewed seams added (`0x5d60eb`, `0x442389`, `0x5410ef`, `0x4ca71f`, RAM `0x200769e4`). |

SybilSight: configure-record flag bit 5 (`sonicRadar.requestDLE`, default on).

## Phone-side findings from the same bench (independent of firmware)

The Video Test measured **1.4 fps and falling** on .68 while `send→img_success` was only
70–150 ms per ~1 KB frame. `sample` put 100 % of the main thread in
`G2ImageCompression.mode8VerticalScrollPayload` — 96 candidate shifts × the whole frame
through generic `IndexingIterator`/`Range` witnesses, 1.0–1.4 s per 288×144 frame on a Debug
build, once per frame, on the main actor. Fixes in the SDK:

1. Row-hash prefilter (64-bit FNV per row, O(frame + shifts × rows)), exact byte count only
   for the few best candidates, and a candidate must at least halve the unshifted
   differing-row count (a video frame never does; a scrolled text page always does).
2. Clock-driven stream pacing in `GlassesDisplayService.playStreamingAnimation`: sleep only
   while ahead of the presentation clock, drop late frames instead of sending every frame
   late.
3. Bench affordances: `videoTest.autoPlay` + `sybilsight://miniapps/video-test` (always
   `open -b guru.am.SybilSight.debug`), `VideoTest: frames=… fps=…` every 5 s.

Measured on CFW .68, relay off (Debug build, Mac Catalyst):

| build | fps | request→done p50 | main-thread hangs |
|---|---|---|---|
| baseline | 1.4 (falling) | 1.8 s | 1.0–1.4 s per frame |
| scroll scan with memcmp + budget | 2.0 | 0.65 s | 0 |
| row-hash prefilter | 3.85 | 0.23 s | 0 |
| + scroll gate (a shift must halve the unshifted differing rows) + clock pacing | 5.1 | 0.18 s | 0 |
| + memcmp row fast path in `changedRegionPlan`/`changedRects`, 8-byte row hashing (on .69) | 6.3 | 0.12 s | 0 |

## Measurements on 2.2.10.69 / 2.2.10.70

- .69 relay off: **6.3 fps**, request→done p50 124 ms = prepare 27 + delta/encode ~15 +
  send→done 83 ms. The temple-side changes did not move `send→done` (83 vs 75–80 ms on .68):
  as predicted, the per-frame CPU on the temple was already small next to the BLE round trip
  (one ~1 KB write + the ACK notify ≈ 2–3 connection events at 30 ms).
- .69 relay on: the relay stream itself is unchanged (bearing lines, all four channels), but the
  configure echo showed `flags=7` — bit 5 never reached `mic_request_dle` because
  `MIC_FLAG_UNREG_PENDING` already owns 0x20 internally and the session-stop path clears it.
  **2.2.10.70** moves the request to bit 7 (`0x80`, the only free bit; the app sends 0x87).
  One relay-on run on .69 measured 7.1 fps with the main thread idle; an earlier one measured
  0.7 fps with 1.0–1.3 s main-thread hangs during the array bring-up window (pre-arm settle,
  before the stream started) — the hang is in the arming path, not the display path, and is
  listed below as follow-up.
- Image session id 0 is never acknowledged by the firmware (`ACK timeout … session=0
  expected=1 left=0 right=0` exactly at the 255th frame of a long stream, `img_success` never
  seen for session 0 in any log). The SDK now skips 0 and cycles 1…254.
- **.70 (flag bit 7, echoed `flags=135`)**: video test **6.2 fps** with the RIGHT temple's
  stream active and **6.3–6.6 fps** in two "relay on" runs, `send→firstAck` p50 **84–85 ms in
  all of them** — the same as an idle link. Caveat on those two runs: their LEFT temple never
  delivered (`frames=0`, `slots=0x80`), so they exercised the RIGHT's stream under DLE, not the
  4-channel relay. Cause found and it is not a .70 regression: the LEFT only arms cleanly on the
  **first** arm after a temple boot, and every one of those runs was a re-arm after a killed
  session (the flash driver's post-check had already armed once). From a fresh reboot .70 brings
  the relay up with DLE on (`flags=135`, LEFT `frames=2745 dma=549`, `relay bearing` lines,
  RIGHT chunks paired).
- **Relay live + video on .70 (aligner fix in the app, fresh boot)**: relay up 61 s after
  launch (178 `relay bearing` lines during the run, LEFT `frames=2760 dma=552`, `flags=135`),
  video test **5.8 fps** on top of the 4-channel stream, `send→firstAck` p50 **97–105 ms**,
  one main-thread hang in the whole run (during arming), one ACK timeout in 502 frames.
  On .68/.69 the same combination measured 0.7–1.4 fps at 238–430 ms ACK latency.
- For comparison, the same relay load on .68/.69 (no effective DLE) pushed the image ACK to
  238–430 ms p50 and the bench to 0.7–1.4 fps.

## Round 2: pipelined delta streaming and partial panel refresh

- **SDK pipelining** (`G2DisplayStreaming.pipelinedDeltas`, set by `GlassesDisplayService`
  around a streaming animation): a mode-3/8 delta that fits one fragment is returned as
  accepted once its fragment is queued; a background waiter runs the same acknowledgement
  tail, and the sender only blocks when more than `pipelinedImageWindow` transfers are still
  unacknowledged (oldest first). A failed deferred transfer makes the next frame report
  rejected, which runs the existing shadow-invalidate + keyframe recovery. Superseded-write
  purging is skipped on this path so a still-queued previous fragment is never dropped, and an
  ordinary (non-stream) transfer first settles the pipeline. The fast connection profile is
  requested once per stream.
- **Measured on .70, relay off, window 2**: **12–12.8 fps** (1,327 frames / 112 s), request→done
  p50 37 ms, no pipeline failures, no ACK timeouts. The send cadence was ~63 ms with a ~120 ms
  write→ACK round trip, i.e. throughput = window / round trip; the window is now 3 (the
  firmware keeps four reassembly contexts).
- **2.2.10.71 partial panel refresh**: the manager's type-3 consumer (`0x4e2ac8` in 2.2.10.10)
  passes the six words unchanged to the panel op `+0x28`; the driver (`0x5aefe8` / async
  `0x5af136`) clamps word 5 to 639 and word 6 to 479 and walks rows `y0…y1` inclusive over
  bytes `x0/2…x1/2`, so the words are `(0, 0, x0, y0, x1, y1)`. `present_shadow` now posts
  `(0, 0, 0, top, 639, bottom−1)` for the dirty rows; keyframes and the unknown-region
  fallback still refresh the whole panel.
- **Measured on .71, window 3**: relay off **11–12.4 fps**; fresh-boot 4-channel relay live
  (177 bearing lines during the run) **11.4 fps, 0 main-thread hangs, 0 ACK timeouts**,
  `send→firstAck` p50 84 ms idle / 110 ms under the relay. Window 3 did not add throughput over
  window 2 and the send spacing never dropped below 40 ms, so the pacer is now the phone's own
  per-frame CPU (decode → PNG → JSON → PNG decode → compositor raster → quantize → delta; the
  clip itself is 30 fps). The sample put the biggest share in
  `DisplayMirrorCanvasRasterizer.fourBitMask` (a per-pixel Swift loop over the full 640×480
  canvas per frame) and `LayoutDirectFramebufferCompositor.monochromeMask`; both are now
  vImage calls: **15 fps average over 147 s (2,189 frames), 16–18 fps in the best 15 s
  windows**, request→done p50 38 ms (prepare 26 + delta), send→firstAck p50 71–95 ms, no ACK
  timeouts. Periodic 15 s windows still dip to ~9 fps (not yet attributed; nothing in the SDK
  log coincides — candidates are the clip's own high-motion stretches producing multi-fragment
  frames, and the stock 60 s slow-interval timer).

- **Final verification, .71, fresh boot, 4-channel relay live** (99 bearing lines during the
  run): video test **15.0 fps, 0 main-thread hangs, 0 ACK timeouts**, request→done p50 35 ms.

## Round 3: gray-canvas path and multipart pipelining

- The compositor now hands the SDK its 8-bit gray 640×480 canvas
  (`CoreBluetoothSDKClient.displayFullPanel640(gray8bpp:drawList:)` → `G2.displayFullPanel640(gray8bpp:)`),
  so the SDK no longer decodes the PNG it would re-derive the same pixels from; the PNG is
  still produced for the phone-side mirror and the draw-record pairing.
- Deltas up to three fragments now pipeline too (the p90 1.9 KB high-motion frames used to
  drop to the serial path and produced the periodic ~9 fps windows).
- **Measured on .71, relay off: 17.6 fps average (2,029 frames / 117 s), 19.5 fps in the best
  15 s window**, request→done p50 41 ms, prepare p50 23 ms, no ACK timeouts, no stalls. One
  earlier run lost the RIGHT link ("timed out unexpectedly") as the stream began; it did not
  reproduce and is recorded as unattributed.
- **Fresh boot, 4-channel relay live, .71 (53 bearing lines during the run): 16.8 fps, 0
  main-thread hangs, 0 ACK timeouts**, request→done p50 36 ms, send→firstAck p50 10 ms (the
  pipeline keeps the link busy, so the first ACK usually precedes the next submit).

### Where the remaining time goes (Debug build)

Per frame the phone still does: GIF frame decode → PNG encode → base64 → JSON display event →
compositor (PNG decode → gray → RGBA → full-canvas raster → 4-bit) → PNG encode → base64 → SDK
(PNG decode → gray → 4-bit quantize → delta). Removing the two PNG round trips (hand the SDK a
packed 4-bit canvas or the image rect directly) is the next step toward the clip's native
30 fps; the link and the temple can already sustain it (write→ACK ~95 ms with three frames in
flight ≈ 30 fps of capacity, temple per-frame work a few ms).

## Round 4: stability items for the migration (2.2.10.72)

- **Notify back-pressure.** The stock msgtx enqueue (`open_cfw_ble_msgtx_enqueue`, 2.2.10.10
  `0x47e5de`) drops a streaming message silently once its 150-entry queue is half full and still
  returns success. The control block is `0x20004780` (queue handle at +0xc, same address in both
  images); the CFW reads the FreeRTOS depth (`Queue_t.uxMessagesWaiting`, handle+0x38) and
  withholds a relay notify at depth ≥ 48 instead of feeding the drop, counting it in
  `relay_notify_skipped`. The RS record grows to 36 bytes (v3: withheld count, queue depth,
  display-gate timeouts); the app parses it and also counts 16-bit sequence gaps on relay frames
  (`SonicRadar: relay sequence gaps …`), so a lost frame is now visible on both ends.
- **Stack.** The 1 KiB inflate output chunk moves from the deferred task's stack (which also
  runs the recursive mode-8 dispatch) into the CFW heap (`ctx->rle_chunk`).
- **Seam map** for the migration: [cfw-seam-map.md](cfw-seam-map.md) lists every `FW_*` seam
  (88 rom-calls) with its reviewed identity — the openCFW / Cordio / zlib / FreeRTOS name where
  known — so the patches can move to symbols on an openCFW-derived tree.
- **Verified on .72 (fresh boot, relay live, video test on top): 17.0 fps, 0 hangs, 0 ACK
  timeouts.** RS v3 from the LEFT: `rx=1955 paired=1952 missing=7 skipped=101 queueDepth=0
  gateTimeouts=0`; the app counted `relay sequence gaps events=219 framesLost=391 over 9500
  frames` (~4 % of relay frames while the video stream shares the notify queue — 101 of them
  withheld deliberately by the back-pressure, the rest lost in the stock path). That loss was
  invisible before this round; it is the number to drive down next (a deeper relay window or
  a lower LC3 bitrate under display load).

## Deferred (documented for the openCFW migration)

- Shadow as the panel DMA source / stock GPU blit instead of the CPU copy (`0x20074514`
  framebuffer base is a writable global in 2.2.6.10; ping-pong shadows needed).
- (Fixed) The main-thread hangs while the relay is live were `RelayCrossTempleAligner.push` →
  `updateLag`: the ±200 ms cross-correlation (~13 M multiply-adds) ran on every 10 ms frame on
  the main actor — 2271 of 2431 main-thread samples under a live relay. The aligner now
  re-estimates on a cadence (50 ms while locking, 200 ms once locked) and uses `vDSP_dotpr` /
  `vDSP_rmsqv`. Verification run below.
- LEFT temple re-arm after an unclean app exit leaves `slots=0x80` and no DMA until the temple reboots (bench: reboot both temples before each array run; `array-cycle2.sh` phase 1).
- HCI recovery hook (`DmDevReset` path) to clear CFW lease/direct state after a radio reset.
- Symbolic seam layer — see `cfw-seam-map.md`; the `FW_*` defines themselves still carry raw addresses.
