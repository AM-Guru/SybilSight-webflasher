"""Validate version-control artifacts without serial/USB access."""
import hashlib
import json
from pathlib import Path
import struct
from case_uart_version_control.protocol import PROFILES, decode_result, POGO_REQUESTS, RECEIVE_MODES
from g2_stock_case_diagnostics import VERSION_REQUESTS


def inspect_build(directory):
    from case_uart_version_control.build import SOURCES
    from case_uart_version_control.validate import case_names
    root = Path(__file__).resolve().parent
    m = json.loads((directory/"validated-manifest.json").read_text())
    payload = (directory/"bridge.bin").read_bytes()
    if m.get("schemaVersion") != 5 or m.get("operation") != "fixed-app-version-uart-control":
        raise ValueError("wrong version-control operation")
    if m.get("payloadBytes") != len(payload) or m.get("payloadSha256") != hashlib.sha256(payload).hexdigest():
        raise ValueError("version payload digest/length mismatch")
    if not 8 < len(payload) < 0x1800 or struct.unpack_from("<II",payload) != (0x20014000,0x20010009):
        raise ValueError("wrong SRAM layout")
    if set(m.get("sourceHashes",{})) != set(SOURCES):
        raise ValueError("incomplete source provenance")
    for name,digest in m["sourceHashes"].items():
        if hashlib.sha256((root/name).read_bytes()).hexdigest() != digest:
            raise ValueError(f"source changed since validation: {name}")
    if m.get("route") not in ("left","right") or m.get("nominalBaud") != 1_000_000 or m.get("profile") not in PROFILES:
        raise ValueError("unsupported version-control parameters")
    if (m.get("attempts"),m.get("receiveIntervalMs"),m.get("nominalReceiveWindowMs")) != (1,400,400):
        raise ValueError("unsupported version-query schedule")
    if m.get("templeCommandAllowlist") != [POGO_REQUESTS[m["route"]].hex()] or m.get("firmwareWriteImplemented") is not False:
        raise ValueError("unexpected command capability")
    if m.get("physicalResetClaimed") is not False or m.get("hardwareValidated") is not False:
        raise ValueError("offline artifacts cannot assert hardware qualification")
    if m.get('templeResetImplemented') is not False:
        raise ValueError('control must have no reset capability')
    if m.get('receiveMode') not in RECEIVE_MODES or m.get('overrunReporting')!='enabled':
        raise ValueError('unsupported receive/overrun configuration')
    cases = m.get("cases",[])
    required=case_names(m['receiveMode'])
    if len(cases) != len(required) or {r.get("case") for r in cases} != set(required) or not all(r.get("completed") is True for r in cases):
        raise ValueError("compiled fault coverage incomplete")
    return m,payload
