"""Fixed reset-probe readiness and retained-result schema. Offline only."""
import struct
import zlib
from g2_sbl_protocol import classify_capture
from case_sbl_reset_prepared.trace import fnv
from case_sbl_reset_prepared.waveforms import WAVEFORM_CODES

PROFILES = {"reviewed-22": 0, "observed-33": 1, "observed-33-entry1": 2, "observed-45": 3}
STRAPS = {"none": 0, "pb8-low": 1, "pb8-high": 3}
POWER_CYCLES = {"none": 0, "route-ae-af": 1}


def ready_bytes(manifest):
    strap = STRAPS[manifest.get("forcedStrap", "none")]
    power_cycle = POWER_CYCLES[manifest.get("powerCycle", "none")]
    waveform = WAVEFORM_CODES[manifest.get("waveform", "stock")]
    config = 8 | 0x07000000 | (int(manifest["route"] == "right") << 8) | (PROFILES[manifest["profile"]] << 16) | (strap << 20) | (power_cycle << 22) | (waveform << 23)
    data = struct.pack("<7I", 0x38523247, config,
        64 if manifest["nominalBaud"] == 1_000_000 else 556,
        20, 400, len(manifest["resetTrace"]["actions"]), manifest["resetTrace"]["actionFnv"])
    return data + struct.pack("<I", zlib.crc32(data) & 0xffffffff)


def parse_ready(data, manifest):
    if data != ready_bytes(manifest):
        raise ValueError("reset readiness CRC/configuration mismatch")
    return {"valid": True, "route": manifest["route"], "nominalBaud": manifest["nominalBaud"], "forcedStrap": manifest.get("forcedStrap", "none"), "powerCycle": manifest.get("powerCycle", "none"), "waveform": manifest.get("waveform", "stock"),
        "readinessEmittedBeforeTrain": True, "receiveMode":"early-armed", "overrunReporting":"enabled", "postTrainUartSetup":"prepared-registers-only", "actionFnv": manifest["resetTrace"]["actionFnv"]}


def decode_result(data, manifest):
    if len(data) != 256 or fnv(data[:252]) != struct.unpack_from("<I", data, 252)[0]:
        raise ValueError("retained result size/checksum mismatch")
    w = struct.unpack_from("<12I", data)
    r = struct.unpack_from("<13I", data, 200)
    if w[:2] != (0x38545352, 8):
        raise ValueError("wrong retained reset-probe schema")
    if w[9] > 20 or w[10] > 8*w[9] or w[11] not in (0, 1) or r[8] % 128 != r[10] or min(r[8], 128) != w[3]:
        raise ValueError("retained transaction/capture bounds differ")
    flags = data[69]
    ticks = struct.unpack_from("<H", data, 70)[0]
    strap = STRAPS[manifest.get("forcedStrap", "none")]
    power_cycle = POWER_CYCLES[manifest.get("powerCycle", "none")]
    action_count = len(manifest["resetTrace"]["actions"])
    expected_ticks = manifest["resetTrace"]["nominalDelayTicks"]
    if flags & ~255 or ticks > expected_ticks or (flags & 1 and (r[3] > action_count or data[68] & 0x53 != (0x40 | strap | (power_cycle << 4)))):
        # Before the train starts, r[3] still holds the checked UART CR2 (0).
        raise ValueError("retained reset bounds differ")
    gpio_restored = bool(flags & 16) and r[11] == r[12]
    restored = w[5] == w[6] == 0x3ff and not w[8] and data[48:58] == data[58:68] and gpio_restored
    complete = flags & 31 == 31 and ticks == expected_ticks and r[2] == manifest["resetTrace"]["actionFnv"] and r[3] == action_count
    if w[9] and (r[5], r[6], r[7]) != (int(manifest["route"] == "left"),64 if manifest["nominalBaud"] == 1_000_000 else 556,20):
        raise ValueError("executed route/baud/schedule mismatch")
    raw = data[72:200]
    raw = raw[r[10]:] + raw[:r[10]] if w[3] == 128 else raw[:w[3]]
    discovery = classify_capture(raw)
    sampled_pb9 = any(kind == 1 for kind, _ in manifest["resetTrace"]["actions"][:r[3]])
    if bool(w[11]) != bool(discovery["statusFrames"]):
        raise ValueError("host and compiled STATUS validation disagree")
    if w[9] and flags & 96 != 96:
        raise ValueError("HELLO lacks early ACK or overrun detection")
    timing=bool(flags&128) and 0<r[4]<=64000
    if flags&128 and (not timing or not 0<r[0]<=0xffffff or not 0<r[1]<=0xffffff or ((r[0]-r[1])&0xffffff)!=r[4]):
        raise ValueError("invalid release counter bound")
    if w[2] == 0 and (flags != 255 or not timing or not complete or not restored or w[7] or not w[9] or w[10] != 8*w[9] or (not w[11] and w[9] != 20)):
        raise ValueError("success lacks complete train, HELLO or restoration evidence")
    return {"status": w[2], "uartErrorMask": w[7], "helloAttempts": w[9],
        "templeBytesSent": w[10], "totalReceiveBytes": r[8], "rawCaptureHex": raw.hex(),
        "resetActionsCompleted": r[3], "nominalDelayTicksCompleted": ticks,
        "resetActionHash": r[2], "trainCompleted": complete,
        "gpioRestorationVerified": gpio_restored, "exactRestorationVerified": restored,
        "baselineHex": data[48:58].hex(), "restoredHex": data[58:68].hex(),
        "receiveMode":"early-armed", "overrunDetectionConfigured":bool(flags&32),
        "earlyReceiveAcknowledgedBeforeTx":bool(flags&64),
        "nativeUartSetupAfterTrain":False,
        "caseReleaseCounterValid":timing,"caseReleaseToFirstTdrUpperCycles":r[4] if flags&128 else None,
        "caseReleaseToFirstTdrUpperUsAtChecked64MHz":r[4]/64 if flags&128 else None,
        "counterStartValue":r[0] if flags&128 else None,"counterEndValue":r[1] if flags&128 else None,
        "forcedStrap": manifest.get("forcedStrap", "none"),
        "waveform": manifest.get("waveform", "stock"),
        "casePb9OutputLatchMatchedAllSamples": bool(data[68] & 0x20) if sampled_pb9 else None,
        "casePb9InputMatchedAllSamples": bool(data[68] & 0x80) if sampled_pb9 else None,
        "casePb9LowObservedAfterLowDrive": bool(data[68] & 4) if sampled_pb9 else None,
        "casePb9HighObservedAfterHighDrive": bool(data[68] & 8) if sampled_pb9 else None,
        "casePb9SenseScope": "case-gpiob-idr-and-odr-after-each-pb9-action",
        "glassesPadVoltageMeasured": False,
        "forcedStrapRegisterSequenceVerified": bool(strap and flags & 1),
        "powerCycle": manifest.get("powerCycle", "none"),
        "chargerRouteCycleCompleted": bool(power_cycle and data[68] & 0x10),
        "chargerRouteCycleUartErrorMask": (r[9] >> 16) & 15 if power_cycle else 0,
        "chargerRouteCycleClaimsApolloReset": False,
        "apolloResetVerified": False, "physicalTimingMeasured": False, "discovery": discovery}
