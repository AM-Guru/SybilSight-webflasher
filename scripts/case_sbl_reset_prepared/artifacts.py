"""Validate reset-probe artifacts without serial/USB access."""
import hashlib
import json
from pathlib import Path
import struct
from case_sbl_reset_prepared.protocol import POWER_CYCLES, PROFILES, STRAPS, decode_result
from case_sbl_reset_prepared.trace import CASE_SHA256, fnv
from case_sbl_reset_prepared.waveforms import WAVEFORM_CODES, derive
from case_sbl_reset_prepared.trace import extract


def inspect_build(directory):
    from case_sbl_reset_prepared.build import SOURCES
    from case_sbl_reset_prepared.validate import CASES, FORCED_CASES, POWER_CASES
    root = Path(__file__).resolve().parent
    m = json.loads((directory/"validated-manifest.json").read_text())
    payload = (directory/"bridge.bin").read_bytes()
    if m.get("schemaVersion") != 8 or m.get("operation") != "prepared-uart-stock-reset-early-hello":
        raise ValueError("wrong reset-probe operation")
    if m.get("payloadBytes") != len(payload) or m.get("payloadSha256") != hashlib.sha256(payload).hexdigest():
        raise ValueError("reset payload digest/length mismatch")
    if not 8 < len(payload) < 0x1800 or struct.unpack_from("<II",payload) != (0x20014000,0x20010009):
        raise ValueError("wrong SRAM layout")
    if set(m.get("sourceHashes",{})) != set(SOURCES):
        raise ValueError("incomplete source provenance")
    for name,digest in m["sourceHashes"].items():
        if hashlib.sha256((root/name).read_bytes()).hexdigest() != digest:
            raise ValueError(f"source changed since validation: {name}")
    if m.get("route") not in ("left","right") or m.get("nominalBaud") not in (115200,1_000_000) or m.get("profile") not in PROFILES:
        raise ValueError("unsupported reset parameters")
    if m.get("forcedStrap") not in STRAPS:
        raise ValueError("unsupported forced strap")
    if m.get("waveform") not in WAVEFORM_CODES:
        raise ValueError("unsupported waveform")
    if m.get("powerCycle") not in POWER_CYCLES:
        raise ValueError("unsupported power cycle")
    expected_power = (3000,50,False) if m.get("powerCycle") == "route-ae-af" else (0,0,False)
    if (m.get("powerOffMs"),m.get("powerSettleMs"),m.get("powerCycleClaimsApolloReset")) != expected_power:
        raise ValueError("unsupported power-cycle timing or reset claim")
    if (m.get("attempts"),m.get("receiveIntervalMs"),m.get("nominalReceiveWindowMs")) != (20,400,8000):
        raise ValueError("unsupported HELLO schedule")
    if m.get("templeCommandAllowlist") != ["14559de900000800"] or m.get("firmwareWriteImplemented") is not False:
        raise ValueError("unexpected command capability")
    if m.get("physicalResetClaimed") is not False or m.get("hardwareValidated") is not False:
        raise ValueError("offline artifacts cannot assert hardware qualification")
    if m.get("receiveMode")!="early-armed" or m.get("overrunReporting")!="enabled":
        raise ValueError("wrong receive mode/overrun policy")
    if m.get("nativeUartSetupAfterTrain") is not False or m.get("maxReleaseToFirstTdrCycles")!=64000:
        raise ValueError("wrong prepared UART/timing policy")
    trace = m["resetTrace"]
    encoded = b"".join(struct.pack("<II",*a) for a in trace["actions"])
    if trace["caseCodeSha256"] != CASE_SHA256 or not 8 <= len(trace["actions"]) <= 206 or trace["nominalDelayTicks"] > 4096 or fnv(encoded) != trace["actionFnv"]:
        raise ValueError("invalid native reset trace identity")
    reference = Path("/Users/kalani/Repo/evenRealities-openCFW/g2/blobs/official/g2-2.2.6.10/firmware_box.bin")
    if trace != json.loads(json.dumps(derive(extract(reference.read_bytes()),m["waveform"]))):
        raise ValueError("reset waveform not derived from pinned stock")
    expected_cases = CASES + (FORCED_CASES if m.get("forcedStrap") != "none" else ()) + (POWER_CASES if m.get("powerCycle") != "none" else ())
    cases = m.get("cases",[])
    if len(cases) != len(expected_cases) or {r.get("case") for r in cases} != set(expected_cases) or not all(r.get("completed") is True for r in cases):
        raise ValueError("compiled fault coverage incomplete")
    return m,payload
