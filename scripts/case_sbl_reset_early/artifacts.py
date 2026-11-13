"""Validate reset-probe artifacts without serial/USB access."""
import hashlib
import json
from pathlib import Path
import struct
from case_sbl_reset_early.protocol import PROFILES, decode_result
from case_sbl_reset_early.trace import CASE_SHA256, fnv


def inspect_build(directory):
    from case_sbl_reset_early.build import SOURCES
    from case_sbl_reset_early.validate import CASES
    root = Path(__file__).resolve().parent
    m = json.loads((directory/"validated-manifest.json").read_text())
    payload = (directory/"bridge.bin").read_bytes()
    if m.get("schemaVersion") != 7 or m.get("operation") != "stock-pb9-reset-then-early-hello":
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
    if (m.get("attempts"),m.get("receiveIntervalMs"),m.get("nominalReceiveWindowMs")) != (20,400,8000):
        raise ValueError("unsupported HELLO schedule")
    if m.get("templeCommandAllowlist") != ["14559de900000800"] or m.get("firmwareWriteImplemented") is not False:
        raise ValueError("unexpected command capability")
    if m.get("physicalResetClaimed") is not False or m.get("hardwareValidated") is not False:
        raise ValueError("offline artifacts cannot assert hardware qualification")
    if m.get("receiveMode")!="early-armed" or m.get("overrunReporting")!="enabled":
        raise ValueError("wrong receive mode/overrun policy")
    trace = m["resetTrace"]
    encoded = b"".join(struct.pack("<II",*a) for a in trace["actions"])
    if trace["caseCodeSha256"] != CASE_SHA256 or len(trace["actions"]) != 103 or fnv(encoded) != trace["actionFnv"]:
        raise ValueError("invalid native reset trace identity")
    cases = m.get("cases",[])
    if len(cases) != len(CASES) or {r.get("case") for r in cases} != set(CASES) or not all(r.get("completed") is True for r in cases):
        raise ValueError("compiled fault coverage incomplete")
    return m,payload
