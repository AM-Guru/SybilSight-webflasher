"""Fixed reset-probe readiness and retained-result schema. Offline only."""
import struct
import zlib
from g2_sbl_protocol import classify_capture
from case_sbl_reset_capture.trace import fnv

PROFILES = {"reviewed-22": 0, "observed-33": 1, "observed-33-entry1": 2, "observed-45": 3}


def ready_bytes(manifest):
    config = 3 | (int(manifest["route"] == "right") << 8) | (PROFILES[manifest["profile"]] << 16)
    data = struct.pack("<7I", 0x54523247, config,
        64 if manifest["nominalBaud"] == 1_000_000 else 556,
        20, 400, 103, manifest["resetTrace"]["actionFnv"])
    return data + struct.pack("<I", zlib.crc32(data) & 0xffffffff)


def parse_ready(data, manifest):
    if data != ready_bytes(manifest):
        raise ValueError("reset readiness CRC/configuration mismatch")
    return {"valid": True, "route": manifest["route"], "nominalBaud": manifest["nominalBaud"],
        "readinessEmittedBeforeTrain": True, "actionFnv": manifest["resetTrace"]["actionFnv"]}


def decode_result(data, manifest):
    if len(data) != 256 or fnv(data[:252]) != struct.unpack_from("<I", data, 252)[0]:
        raise ValueError("retained result size/checksum mismatch")
    w = struct.unpack_from("<12I", data)
    r = struct.unpack_from("<13I", data, 200)
    if w[:2] != (0x33545352, 3):
        raise ValueError("wrong retained reset-probe schema")
    if w[9] > 20 or w[10] > 8*w[9] or w[11] not in (0, 1) or r[8] % 128 != r[10] or min(r[8], 128) != w[3]:
        raise ValueError("retained transaction/capture bounds differ")
    flags = data[69]
    ticks = struct.unpack_from("<H", data, 70)[0]
    if flags & ~31 or ticks > 62 or (flags & 1 and (r[3] > 103 or data[68] != 0x40)):
        # Before the train starts, r[3] still holds the checked UART CR2 (0).
        raise ValueError("retained reset bounds differ")
    gpio_restored = bool(flags & 16) and r[11] == r[12]
    restored = w[5] == w[6] == 0x3ff and not w[8] and data[48:58] == data[58:68] and gpio_restored
    complete = flags == 31 and ticks == 62 and r[2] == manifest["resetTrace"]["actionFnv"] and r[3] == 103
    if w[9] and (r[5], r[6], r[7]) != (int(manifest["route"] == "left"),64 if manifest["nominalBaud"] == 1_000_000 else 556,20):
        raise ValueError("executed route/baud/schedule mismatch")
    raw = data[72:200]
    raw = raw[r[10]:] + raw[:r[10]] if w[3] == 128 else raw[:w[3]]
    discovery = classify_capture(raw)
    if bool(w[11]) != bool(discovery["statusFrames"]):
        raise ValueError("host and compiled STATUS validation disagree")
    if w[2] == 0 and (not complete or not restored or w[7] or not w[9] or w[10] != 8*w[9] or (not w[11] and w[9] != 20)):
        raise ValueError("success lacks complete train, HELLO or restoration evidence")
    return {"status": w[2], "uartErrorMask": w[7], "helloAttempts": w[9],
        "templeBytesSent": w[10], "totalReceiveBytes": r[8], "rawCaptureHex": raw.hex(),
        "resetActionsCompleted": r[3], "nominalDelayTicksCompleted": ticks,
        "resetActionHash": r[2], "trainCompleted": complete,
        "gpioRestorationVerified": gpio_restored, "exactRestorationVerified": restored,
        "baselineHex": data[48:58].hex(), "restoredHex": data[58:68].hex(),
        "apolloResetVerified": False, "physicalTimingMeasured": False, "discovery": discovery}
