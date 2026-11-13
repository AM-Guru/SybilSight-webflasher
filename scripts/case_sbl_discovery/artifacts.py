"""Offline-only prototype artifact checks; no serial or USB imports."""
import hashlib
import json
from pathlib import Path
import struct

from g2_sbl_protocol import HELLO, classify_capture, ENTRY_BIASES, bias_configuration
from case_sbl_discovery.validate import case_names, fnv, ordered_capture

RESULT_BYTES = 256

def digest(data):
    return hashlib.sha256(data).hexdigest()


def inspect_build(directory):
    manifest = json.loads((directory / "validated-manifest.json").read_text())
    payload = (directory / "bridge.bin").read_bytes()
    if manifest.get("schemaVersion") != 2 or manifest.get("operation") != "fixed-hello-discovery-only":
        raise ValueError("unsupported build manifest")
    if manifest.get("payloadBytes") != len(payload) or manifest.get("payloadSha256") != digest(payload):
        raise ValueError("payload digest or length mismatch")
    if not 8 < len(payload) < 0x1800 or struct.unpack_from("<II", payload) != (0x20014000, 0x20010009):
        raise ValueError("payload SRAM layout differs")
    from case_sbl_discovery.build import SOURCES, PROFILES
    if set(manifest.get("sourceHashes", {})) != set(SOURCES):
        raise ValueError("incomplete source provenance")
    for name, expected in manifest["sourceHashes"].items():
        if digest((Path(__file__).parent / name).read_bytes()) != expected:
            raise ValueError(f"source changed after compiled validation: {name}")
    cases = manifest.get("cases", [])
    biases = {name:bias_configuration(name) for name in ENTRY_BIASES}
    names = [name for name,value in biases.items() if value == manifest.get("entryBias")]
    if len(names) != 1 or "entryBias" not in manifest:
        raise ValueError("unsupported entry bias; only fixed input-pull candidates are allowed")
    required_cases = case_names(names[0])
    if len(cases) != len(required_cases) or {c.get("case") for c in cases} != set(required_cases) or not all(c.get("completed") is True for c in cases):
        raise ValueError("compiled fault coverage incomplete")
    if manifest.get("templeCommandAllowlist") != [HELLO.hex()] or manifest.get("firmwareWriteImplemented") is not False:
        raise ValueError("unexpected temple command capability")
    if manifest.get("route") not in ("left", "right") or manifest.get("nominalBaud") not in (115200, 1000000) or manifest.get("profile") not in PROFILES or manifest.get("attempts") not in (20, 4000):
        raise ValueError("unsupported discovery parameters")
    interval = 400 if manifest["attempts"] == 20 else 20
    if manifest.get("receiveIntervalMs") != interval or manifest.get("nominalReceiveWindowMs") != interval * manifest["attempts"]:
        raise ValueError("unsupported receive timing")
    return manifest, payload



def decode_result(data, manifest):
    if len(data) != RESULT_BYTES:
        raise ValueError("result length mismatch")
    words = struct.unpack_from("<12I", data)
    if words[:2] != (0x314c4253, 1) or fnv(data[:252]) != struct.unpack_from("<I", data, 252)[0]:
        raise ValueError("retained result completion/checksum mismatch")
    registers = struct.unpack_from("<13I", data, 200)
    if words[9] > manifest["attempts"] or words[10] > words[9] * 8 or words[11] not in (0, 1):
        raise ValueError("retained transaction bounds differ from fixed schedule")
    if words[9] and (registers[5] != int(manifest["route"] == "left") or registers[6] != (64 if manifest["nominalBaud"] == 1000000 else 556) or registers[7] != manifest["attempts"]):
        raise ValueError("executed route/baud/schedule differs from validated manifest")
    raw = ordered_capture(data)
    if words[3] != min(registers[8], 128) or registers[10] != registers[8] % 128:
        raise ValueError("retained capture counters disagree")
    discovery = classify_capture(raw)
    if bool(words[11]) != bool(discovery["statusFrames"]):
        raise ValueError("compiled and host STATUS validators disagree")
    restored = words[5] == words[6] == 0x3ff and words[8] == 0 and data[48:58] == data[58:68]
    zero_write_stop = words[2] == 1 and words[4] == words[9] == words[10] == words[11] == 0
    bias = manifest.get("entryBias")
    bias_report = None
    if bias:
        config, flags, ticks = struct.unpack_from("<BBH", data, 68)
        if not zero_write_stop and config != (0x80 | bias["casePin"] | (bias["level"] << 4)):
            raise ValueError("executed GPIO bias differs from validated manifest")
        if ticks > bias["holdMs"] or flags & ~63:
            raise ValueError("retained GPIO bias bounds differ")
        gpio_restored = bool(flags & 16) and registers[11] == registers[12]
        completed = flags == 31 and ticks == bias["holdMs"] and gpio_restored
        if words[2] == 0 and not completed:
            raise ValueError("successful result lacks complete bias/level/release/restoration proof")
        restored = restored and gpio_restored
        bias_report = {**bias, "flags":flags, "holdTicksMs":ticks,
            "biasConfigured":bool(flags & 1), "readinessConfirmsInitialPadLevel":bool(flags & 2),
            "readyEmitted":bool(flags & 2), "windowCompleted":bool(flags & 4),
            "released":bool(flags & 8), "gpioRestorationVerified":gpio_restored,
            "padMismatch":bool(flags & 32), "baselinePinFields":f"{registers[11]:08x}",
            "restoredPinFields":f"{registers[12]:08x}", "apolloPinLevelVerified":False,
            "physicalResetVerified":False}
        if words[10] == 0 and words[2] in (11,15):
            values = struct.unpack_from("<5I",data,72)
            bias_report["stopRegisters"] = dict(zip(("gpioBModer","gpioBPupdr","gpioBIdr","watchdogPinMask","watchdogMode"),(f"{v:08x}" for v in values)))
    if words[2] == 0 and (words[9] == 0 or words[10] != words[9] * 8 or (not words[11] and words[9] != manifest["attempts"])):
        raise ValueError("successful result lacks complete fixed HELLO transactions")
    return {
        "status": words[2], "captureBytesStored": words[3], "yhmWriteMask": words[4],
        "baselineReadMask": words[5], "restoredReadMask": words[6], "uartErrorMask": words[7],
        "restorationFailureMask": words[8], "helloAttempts": words[9], "templeBytesSent": words[10],
        "baselineHex": data[48:58].hex(), "restoredHex": data[58:68].hex(),
        "exactRestorationVerified": restored, "zeroWriteSetupStopVerified": zero_write_stop,
        "totalReceiveBytes": registers[8], "externalWatchdogServices": registers[9],
        "rawCaptureHex": raw.hex(), "discovery": discovery,
        "entryBias": bias_report,
    }


