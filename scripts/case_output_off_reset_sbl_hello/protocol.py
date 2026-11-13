"""Schema-16 seated YHM off-reset-sbl-hello UART and PB9 evidence."""

import struct

from case_sbl_reset_prepared.trace import fnv
from g2_even_bootlog import classify_even_bootloader_log
from g2_sbl_protocol import find_status_frames


RAW_CAPACITY = 988
EVIDENCE_BYTES = 1280


def configuration(route, nonce):
    if route not in ("left", "right") or not 0 < nonce < 2**32:
        raise ValueError("invalid passive bootlog configuration")
    body = struct.pack(
        "<7I", 0x4B483247, 0xB4B7CDB8, 17, int(route == "right"), 64, nonce, 15000
    )
    return body + struct.pack("<I", fnv(body))


def decode(data):
    if len(data) != EVIDENCE_BYTES or fnv(data[:-4]) != struct.unpack_from("<I", data, EVIDENCE_BYTES - 4)[0]:
        raise ValueError("passive bootlog evidence size/checksum differs")
    words = struct.unpack_from("<72I", data)
    if (
        words[:2] != (0x31484E47, 17)
        or words[3] != 5
        or words[5] > 1
        or words[6] != 64
        or not words[7]
        or words[4] != (0x08009B15 if words[5] else 0x08009AFF)
        or words[19] > RAW_CAPACITY
        or words[27] > 160
        or words[27] % 8
    ):
        raise ValueError("passive bootlog evidence header differs")
    retained = min(words[18], RAW_CAPACITY)
    raw = data[288:288 + retained]
    context = words[8:14] == (0, 0, 2, 2, 1, 1) and words[23:25] == (0, 0)
    clock = (
        words[28:32] == (7, 63999, 7, 63999)
        and words[58:60] == (0x12, 0x32020802)
        and not (words[57] | words[61]) & 0x30
    )
    restored = (
        words[21] == 7
        and words[62:64] == (1, 1)
        and (words[56] ^ words[60]) & (1 << 18) == 0
    )
    waited = 11_900 <= ((words[25] - words[14]) & 0xFFFFFFFF) <= 12_100
    captured = (words[17] - words[16]) & 0xFFFFFFFF
    post_pulse = (words[17] - words[15]) & 0xFFFFFFFF
    edge_rows = []
    for phase, base in (("pre-pulse", 64), ("post-pulse", 68)):
        samples, transitions, low, flags = words[base:base + 4]
        valid = (
            samples > 0
            and transitions < samples
            and low <= samples
            and flags & 4
            and flags & ~7 == 0
        )
        edge_rows.append({
            "phase": phase,
            "samples": samples,
            "transitions": transitions,
            "lowSamples": low,
            "firstLevelHigh": bool(flags & 1),
            "lastLevelHigh": bool(flags & 2),
            "qualified": bool(valid),
        })
    if words[2] == 0 and (
        not context
        or not clock
        or not restored
        or not waited
        or not 14_900 <= captured <= 15_100
        or not 11_900 <= post_pulse <= 12_100
        or words[26] != 15000
        or words[27] != 160
        or words[22] & ~(7 | 256 | 512 | 1024 | (15 << 16))
        or words[22] & (256 | 512 | 1024) != (256 | 512 | 1024)
        or not all(row["qualified"] for row in edge_rows)
    ):
        raise ValueError("passive bootlog success lacks context, duration, or cleanup")
    return {
        "status": words[2],
        "route": "right" if words[5] else "left",
        "caller": hex(words[4]),
        "brr": words[6],
        "nonce": words[7],
        "probeQualified": (
            words[2] == 0 and context and clock and restored and waited
            and words[22] & (256 | 512 | 1024) == (256 | 512 | 1024)
        ),
        "nativeContextVerified": context,
        "exactPeripheralRestorationVerified": restored,
        "captureClock": "systick-wrap-counter",
        "insertionWaitSystickWraps": (words[25] - words[14]) & 0xFFFFFFFF,
        "passiveCaptureSystickWraps": captured,
        "postPulseCaptureSystickWraps": post_pulse,
        "halTickStart": words[32],
        "halTickEnd": words[33],
        "captureStartedBeforeInsertion": False,
        "captureStartedBeforeYhmOnEdge": bool(words[22] & 256),
        "yhmOnEdgeCommandIssued": bool(words[22] & 512),
        "yhmOffRestoredBeforeReturn": bool(words[22] & 1024),
        "yhmEdgeProofBoundary": (
            "The Case native setter and its shadow cache were exercised; "
            "this does not measure pogo voltage or Apollo reset."
        ),
        "retentionPolicy": "first-bytes-saturating",
        "totalReceiveBytes": words[18],
        "retainedReceiveBytes": retained,
        "captureOverflowed": words[18] > RAW_CAPACITY,
        "uartErrorMask": words[20],
        "uartCleanAfterYhmOnEdge": words[20] == 0,
        "discardedOffStateUartErrorMask": (words[22] >> 16) & 15,
        "templeBytesSent": words[27],
        "fixedHelloAttempts": words[27] // 8,
        "rawCaptureHex": raw.hex(),
        "sblStatusFrames": find_status_frames(raw),
        "evenBootloaderLog": classify_even_bootloader_log(raw),
        "rawPb9Observation": {
            "prePulse": edge_rows[0],
            "postPulse": edge_rows[1],
            "electricalActivityObserved": any(row["transitions"] for row in edge_rows),
            "proofBoundary": (
                "PB9 IDR transitions prove only digital activity at the Case receive pin. "
                "They do not identify the source, prove Apollo reset, or authenticate a boot stage."
            ),
        },
        "physicalApolloResetVerified": False,
        "glassesFirmwareImageBytesSent": 0,
        "retailRecoveryVerified": False,
    }
