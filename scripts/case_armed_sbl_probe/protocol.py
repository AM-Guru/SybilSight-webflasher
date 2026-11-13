"""Bounded armed-insertion SBL probe configuration and evidence schema 12."""
import struct

from case_sbl_reset_prepared.trace import fnv
from g2_sbl_protocol import classify_capture


def configuration(route, baud, nonce):
    if route not in ("left", "right") or baud not in (1_000_000, 115_200):
        raise ValueError("unsupported armed SBL configuration")
    if not 0 < nonce < 2**32:
        raise ValueError("nonce must be a nonzero uint32")
    body = struct.pack(
        "<7I",
        0x4B483247,
        0xB4B7CDB8,
        12,
        int(route == "right"),
        64 if baud == 1_000_000 else 556,
        nonce,
        4,
    )
    return body + struct.pack("<I", fnv(body))


def decode(data):
    if len(data) != 512 or fnv(data[:508]) != struct.unpack_from("<I", data, 508)[0]:
        raise ValueError("armed SBL evidence size/checksum differs")
    words = struct.unpack_from("<64I", data)
    if (
        words[:2] != (0x31484E47, 12)
        or words[3] != 5
        or words[5] > 1
        or words[6] not in (64, 556)
        or not words[7]
        or words[4] != (0x08009B15 if words[5] else 0x08009AFF)
    ):
        raise ValueError("armed SBL caller/config/phase differs")
    if words[2] > 10 or words[18] > 4 or words[19] > 8 * words[18]:
        raise ValueError("armed SBL capture bounds differ")
    if words[21] != words[20] % 128 or words[23] > 1:
        raise ValueError("armed SBL ring/status bounds differ")
    raw = data[256:384]
    retained = min(words[20], 128)
    raw = raw[words[21]:] + raw[:words[21]] if retained == 128 else raw[:retained]
    discovery = classify_capture(raw)
    if bool(words[23]) != bool(discovery["statusFrames"]):
        raise ValueError("host/compiled STATUS validation differs")
    context = words[8:14] == (0, 0, 2, 2, 1, 1) and words[26:28] == (0, 0)
    clock = (
        words[30:32] == (7, 63999)
        and words[58:60] == (0x12, 0x32020802)
        and not (words[57] | words[61]) & 0x30
    )
    restored = (
        words[24] == 7
        and words[62:64] == (1, 1)
        and (words[56] ^ words[60]) & (1 << 18) == 0
        and words[30:32] == words[32:34]
    )
    waited = 14_900 <= ((words[29] - words[14]) & 0xFFFFFFFF) <= 15_100
    if words[2] == 0 and (
        not context
        or not clock
        or not restored
        or not waited
        or words[25] != 3
        or words[22]
        or not words[18]
        or words[19] != 8 * words[18]
        or words[28] != words[18] - 1
        or words[34:37] != (0, 0, 0)
        or words[37] not in (0, 64)
        or words[38] != 0
        or (not words[23] and words[18] != 4)
    ):
        raise ValueError("success lacks insertion wait, context, exchange, or cleanup")
    return {
        "status": words[2],
        "route": "right" if words[5] else "left",
        "caller": hex(words[4]),
        "brr": words[6],
        "nonce": words[7],
        "probeQualified": words[2] == 0 and context and clock and restored and waited and not words[22],
        "nativeContextVerified": context,
        "exactPeripheralRestorationVerified": restored,
        "insertionWaitHalTicks": (words[29] - words[14]) & 0xFFFFFFFF,
        "nativePulseHalTicks": (words[15] - words[29]) & 0xFFFFFFFF,
        "pulseReturnToFirstTxHalTicks": (words[16] - words[15]) & 0xFFFFFFFF if words[19] else None,
        "helloAttempts": words[18],
        "templeBytesSent": words[19],
        "totalReceiveBytes": words[20],
        "uartErrorMask": words[22],
        "rtosYields": words[28],
        "rawCaptureHex": raw.hex(),
        "discovery": discovery,
        "uartBefore": list(words[34:39]),
        "uartAfter": list(words[39:44]),
        "gpioBefore": list(words[44:50]),
        "gpioAfter": list(words[50:56]),
        "caseBusyLockHeldDuringWait": waited,
        "rtosTickReconfigured": False,
        "physicalApolloResetVerified": False,
        "glassesFirmwareImageBytesSent": 0,
        "retailRecoveryVerified": False,
    }
