# G2 CFW microphone relay: four channels over one link

Status: design + first implementation (CFW 2.2.10.62 "relay" candidate). Written 2026-09-15.

## Goal

Both temples capture their two GX8002 microphone channels at 16 kHz / 16-bit. The RIGHT
temple LC3-encodes its pair and sends the frames to the LEFT over the wired inter-temple
link. The LEFT encodes its own pair, merges the four channels frame by frame, and emits a
single 4-channel LC3 stream to the phone over its one BLE link. SybilSight decodes the four
channels with the liblc3 already bundled in the SDK, runs beamforming, noise reduction and
speaker identification on the phone, and feeds the two speech consumers:

- privileged computer commands: accepted only when the diarised speaker matches the
  enrolled wearer (speaker verification gate);
- general recognition (captions, translation, the facts engine): any speaker, attributed.

## Why this shape

- Airtime: today two raw 16 kHz stereo streams (2 × 64 kB/s) run over two BLE links and
  the stock notify path silently drops streaming messages once its queue is half full. Four
  LC3 channels at 32 kbps are 16 kB/s on one link.
- One clock domain per stream: the LEFT owns the merge, so the phone never pairs frames by
  arrival time again.
- The codec bring-up problem is unchanged by the transport: the LEFT's clean recipe
  (stock-driven init, ~12 s untouched, then tap) is measured; the RIGHT's I2S alignment is
  still open and its channels will carry whatever its capture produces until that is fixed.

## Codec choice

| parameter | value | reason |
|---|---|---|
| sample rate | 16 kHz | native GX8002 I2S rate; speech recognisers want 16 kHz |
| bit depth | 16-bit PCM in, LC3 | native DMA format |
| frame duration | 10 ms | stock G2 LC3 uses 10 ms; SDK decoder is fixed at 10 ms |
| bitrate | 32 kbps per channel (40-byte frames), phone-selectable 16–64 kbps (20–80 B) | matches stock quality; SDK decoder accepts 20/40/60 B frames today |
| channels | 4: L-front, L-rear, R-front, R-rear | fixed order in every packet |

The encoder is the stock wrapper `SVC_Lc3EncodeMono(pcm, bytes, out, &outLen, ctx)` at
2.2.10.10 0x595d3c (2.2.9.22 0x593138) driven with CFW-owned contexts. A context is
`{u8 fmt; u32 dt_us; u32 sr_hz; u32 nch; u32 ch; u32 bitrate; void *enc; u8 mem[]}`; the
encoder memory lives inline after 0x1c and is created lazily through
`lc3_setup_encoder(dt_us, sr_hz, 0, mem)` at 0x5ad5a4 (2.2.9.22 0x5aa97c). With `nch = 2`
and `ch = 0/1` the wrapper encodes one channel of an interleaved buffer, so each temple
runs two contexts over the same 3200-byte DMA chunk (800 stereo frames = 5 LC3 frames).

## Inter-temple link (what openCFW establishes, verified against 2.2.10.10)

- Physical: one Apollo510 UART per temple, driven by the stock `uart_sync.c` worker
  (mutex + event flags + a 24,576-byte receive stream; RX drains ≤1,024 B per iteration,
  ≤32 chunks per wake; TX is a synchronous write with a 100-tick timeout). Pins, baud and
  IRQ priority are not recovered anywhere; the HAL caps the rate at 3 Mbps.
- Framing: TinyFrame, `SOF 0x01 | ID(2) | LEN(2) | TYPE(2) | HEAD_CRC(2) | DATA | DATA_CRC(2)`,
  big-endian, CRC-16/ARC; RX accepts payloads up to 24,576 B; the send buffer is 1,024 B
  (larger payloads go multipart). Role 1 (RIGHT) is the TinyFrame master, role 2 (LEFT) the
  slave and the audio-hardware owner.
- Common-data layer: a 43-row × 16-byte registry `{id, callback, ui_callback, state}` at
  rodata 0x6c1140..0x6c13f0 (2.2.10.10), copied to SRAM at boot; the audio manager's peer
  sync is id 0x010C at row 0x6c12a0 (callback 0x56b1f6) — the slot the .51+ hook repoints.
  Sends go through `common_data_send(record_id, buf, len, 0)` at 0x46b0ac (2.2.9.22
  0x46aac8, identical body), found by mapping the audio manager's sender
  (`AUDM_SendSyncMsgToPeer`, 2.2.6.10 0x54F694) into both images; they are queued and
  drained by the UART worker, and handlers run on a first-party thread pool.
- Stock traffic on the link: the 0x010C audio handshake (event-driven, 1 byte), battery
  sync (0x0105, 12 B), silent mode (0x010A), lens status (0x0103), EvenHub (0x00E0) and a
  few more; none is periodic at audio rates.

The relay reuses id 0x010C with CFW magic first bytes (0xA5..0xA8) that the stock one-byte
protocol never uses; the hook consumes relay packets and forwards everything else.

Packet (RIGHT → LEFT, one per 10 ms LC3 frame pair, or two frames per packet when the link
budget allows):

```
u8  magic = 0xA5 ('relay audio')
u16 seq            right-side frame counter since START
u32 left_tick_ms   right's capture tick translated into the LEFT's tick domain
u8  nframes        LC3 frames in this packet (1 or 2)
u8  fbytes         bytes per channel frame (20..80)
u8  flags          bit0 right capture healthy (dma advancing), bit1 resync happened
[nframes × 2 × fbytes] LC3 data, channel-major (front frame, rear frame) per LC3 frame
```

Control packets (LEFT → RIGHT): `0xA6 START {u32 left_tick_ms, u8 fbytes}` at arm (the
RIGHT replies `0xA7 ACK {u32 right_tick_ms}` so the LEFT can estimate the tick offset from
the round trip) and `0xA8 STOP`.

Link budget at 32 kbps × 2 channels: 84 B per 10 ms packet ≈ 67 kbps + TinyFrame framing.
The HAL caps the UART at 3 Mbps; the configured peer rate is read at run time (status
field) and, if it is below 230.4 kbps, the relay batches two frames per packet and drops
to 24 kbps per channel. Stock traffic on the link (peer sync, wear state) is tiny and
unaffected because relay packets are only sent while the array is armed.

## Timing model

Each temple's I2S clock is free-running (no cross-temple sample sync). The RIGHT stamps
every packet with its DMA tick translated into the LEFT's tick domain using the START/ACK
round trip (accuracy ≈ ±1–2 ms). The LEFT pairs each of its LC3 frames with the RIGHT frame
whose translated tick is nearest (a 6-frame jitter buffer keyed by tick); a missing RIGHT
frame is marked in the phone packet (the SDK decoder runs packet-loss concealment), and a
RIGHT frame that drifts by more than 30 ms triggers a resync (drop or duplicate, flagged).
The residual sub-frame offset is carried to the phone (`right_offset_ms`, signed 8-bit) so
the beamformer can pre-shift the right channels before cross-correlation.

## Phone stream (LEFT → phone)

Existing array stream header (21 bytes, `'S','M',1`, flags, seq, tick, rate, codec …) with
codec = 0 (LC3), channel mask 0x0F, then:

```
u8  nframes        LC3 frames in this notify (5 = one 50 ms DMA chunk)
u8  fbytes
s8  right_offset_ms
u8  present_mask   bit per frame: right frame present
[nframes × 4 × fbytes] LC3 data, channel-major: L-front, L-rear, R-front, R-rear
```

One notify per 50 ms chunk ≈ 830 bytes at 40-byte frames; 20 notifies per second.

## Implementation status (2026-09-15)

- Firmware: CFW 2.2.10.62 (`scripts/cfw/overlays/2.2.10.62`, pinned in the webflasher).
  One 50 ms chunk per packet (RIGHT → LEFT: 10-byte header + 2 × 5 × fbytes); LEFT pairs
  whole chunks by the RIGHT's translated tick within ±60 ms and emits one notify per chunk
  (21-byte 'SM' header, codec 0, nCh 4, flags bit2, then `nframes, fbytes, offset_ms,
  present` and 4 × 5 × fbytes of LC3). A 20-byte 'RS' statistics record goes to the phone
  every 40 chunks. Encoder contexts (2 × 2,720 B), the RIGHT-chunk ring (4 × 812 B) and the
  assembly buffer live in heap 13. The tick offset is measured once at START (no round-trip
  correction yet; link transit is ~1 ms).
- SDK (`Bridge.swift`): 4-channel LC3 frames are transcoded with four `PcmConverter`
  instances (packet-loss concealment for a missing RIGHT chunk) into the same frame as
  planar PCM16 (codec 1, nCh 4) before the app sees them.
- App (`SonicRadarService`): 4-channel frames bypass arrival-time pairing, shift the RIGHT
  pair by the reported chunk offset, estimate the bearing on the two front channels, and run
  the existing four-microphone processor (beamforming + noise cancellation) into the same
  speech sinks. `G2.swift`: `sonicRadar.relay` (codec 0) and `sonicRadar.relayBitrate`
  knobs; 'RS' records are logged as "relay stats".
- Not yet done: speaker-verification gate for privileged commands (see below), continuous
  sub-chunk alignment (the offset is applied per 50 ms chunk with zero fill), raising the
  UART baud, encode-time measurement.

## Build note: 64 KiB PC-relative reach

The patch blob takes its own function addresses with `&fn`, which under `-fropi` becomes a
PC-relative `movw/movt` pair; the assembler rejects that pair when the target is more than
64 KiB away. Clang emits static functions lazily (at first use), so the relay code, pulled
in by the PCM tap, landed between zlib's allocator callbacks and their use. Fix: the
callbacks and `seq_tick` are now `static`, so they are emitted next to their users.

## App

- `SonicMicrophoneFrame.decode`: codec 0 decodes the four channels with four `PcmConverter`
  instances (10 ms / 16 kHz / configurable frame bytes); missing right frames go through
  `decodeLostFrames`.
- `SonicRadarService.ingest`: a 4-channel frame is already paired; it skips the arrival-time
  pairing and runs the bearing estimate on channels 0 and 2, then forwards the 4-channel PCM
  to the existing processed-audio sinks (local runtime, captions, radar).
- Speaker gate: already implemented in `VoiceCommandGate` (SybilSight/Services): a
  privileged computer command is allowed only when the utterance's WeSpeaker embedding
  matches the enrolled wearer voiceprint above a duration-dependent cosine threshold AND
  the array bearing sits within 35° of the wearer's calibrated mouth bearing; consequential
  verbs additionally need a spoken confirmation, and `requireWearerVoiceprint` blocks
  commands outright until "Learn my voice" has run. The relay ingest path updates the same
  `heardDeviceDegrees` state the gate reads, so the bearing factor keeps working with the
  single-link stream. General recognition (captions, translation, facts) is not gated and
  keeps per-speaker attribution from the diariser (`isWearer` marks the wearer as "Me").

## Fallbacks and switches

CONFIGURE `codec` = 0 selects the relay; codec 1 (raw PCM per temple) and 2 (ADPCM)
stay available. `bitrate` (100 bps units) selects the LC3 bitrate. The RIGHT keeps its BLE
link to the phone for control and status only.

## Debugging log: the common-data hook ABI (2.2.10.63–.65)

First relay run: the LEFT selected codec 0, encoded, and streamed 4-channel notifies, and
the app received them — but the RIGHT never joined (`started=0`, `rx=0`), so the right
channels were silence. Both-side stat counters (.63) showed the RIGHT's hook firing
(`hookCalls` climbing) but never recognising a relay magic (`ctlRx=0`), and the LEFT's hook
never firing at all. Disassembling the stock 0x010C handler (2.2.10.10 0x56b1f6) settled it:
the common-data dispatch calls a registered handler as
`handler(uint32_t recordId, const uint8_t *data, uint32_t length, void *entry)` — the record
id is the FIRST argument, data the second. The `.51–.64` hook was declared
`mic_peer_sync_hook(const uint8_t *data, uint32_t len)`, so it read the record id (0x10C) as
its data pointer and the real data pointer as its length; `data[0]` dereferenced address
0x10C and never matched a magic. `.65` fixes the hook and the stock-forward to the 4-argument
ABI. (This also means the `.51–.61` peer-sync-deaf forward passed stock the wrong arguments;
harmless there because relay was inactive, but corrected now.)

## Working end-to-end (2.2.10.68)

The relay is functional on hardware. Progression:
- `.65` fixed the common-data hook ABI → the RIGHT recognises the START and the handshake completes.
- `.66` added a LEFT START heartbeat + idempotent RIGHT re-sync; the app stops re-CONFIGuring the RIGHT in relay mode. The RIGHT streams audio packets to the LEFT (`tx` climbing), the LEFT receives them (`rx` climbing).
- `.67` emits one LC3 frame per BLE notify (≈185 B) so the phone stops dropping the oversized 4-channel notify. The phone decodes `4×160`-sample frames; LEFT channels carry real audio.
- `.68` replaces the fragile cross-temple tick pairing with FIFO (arrival-order) pairing. **All four channels now carry real audio** (`peak/rms` non-zero on every channel, `right present=1`), `paired` tracks `rx`, and the phone computes a bearing from the merged stream.

Measured: 4 channels, 16 kHz, 40-byte (32 kbps) LC3 frames, one 4-channel frame per notify at 100 notifies/s, decoded by the SDK's liblc3 and fed to the app's beamforming/ASR/speaker pipeline.

### Known limitation: pairing latency vs beamforming

FIFO pairing takes the oldest un-consumed RIGHT chunk, so the right channels lag the left by ~100-127 ms (`offsetMs` clamps at -127). That is fine for ASR, diarisation and speaker verification (each channel is intact), but the ~110 ms offset is far larger than the ~0.4 ms inter-mic delay beamforming needs, so the array bearing is unreliable (conf ≈ 0.2). To fix: pair with the newest RIGHT chunk (or a shallow 1-2 deep ring) so the offset drops under ~50 ms, and widen the `offsetMs` field beyond int8 so the phone can pre-shift exactly before cross-correlation.

### App knobs
`sonicRadar.relay` (bool) selects the relay (CONFIGURE codec 0); `sonicRadar.relayBitrate` (16000-42000, default 32000) sets the per-channel LC3 bitrate.

## Finalized: default-on relay + phone-side beamforming alignment (app)

The relay is the default audio path on CFW (Faceclaw/3) builds — `sonicRadar.relay` defaults
on; set it false to fall back to the per-temple ADPCM/raw path. Verbose relay telemetry (the
'RS' stat log and the per-frame decode/level log) is gated behind `sonicRadar.relayDebug`.

Beamforming fix (app, no reflash): the two temples free-run, so the relay delivers the RIGHT
channels with a coarse, drifting offset (~60-110 ms) that the array beamformer and the ±7-sample
bearing estimator cannot absorb. `RelayCrossTempleAligner` (SonicRadarService) keeps a rolling
history of all four channels, cross-correlates L-front against R-front to lock and then track
the inter-temple lag (±200 ms lock, ±20 ms tracking, 0.30 correlation gate, EMA smoothing), and
emits the four channels sample-aligned before `processPair`. Measured: it locks (`locked=true`,
`alignLagMs≈60`) and the bearing estimate then runs continuously at conf ≈ 0.22-0.49. It adds a
~250 ms fixed base delay (fine for captions/ASR/commands). Firmware pairing stays FIFO (.68) so
the channel streams remain continuous for the correlation; that is preferable to newest-chunk
pairing, which would risk gaps.

Remaining polish (optional): a user-facing toggle for the relay; trimming the firmware's 32-byte
diagnostic 'RS' record to a lean production telemetry record; reducing end-to-end latency by
lowering the aligner base delay once the relay offset is characterised per unit.
