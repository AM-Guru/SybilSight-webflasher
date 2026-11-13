"""Offline early HELLO artifact checks; no device transport imports."""
import hashlib
import json
from pathlib import Path
import struct
from g2_sbl_protocol import HELLO
from case_early_sbl_probe.protocol import PROFILES,decode_result

def inspect_build(directory):
    from case_early_sbl_probe.build import SOURCES
    from case_early_sbl_probe.validate import CASES
    root=Path(__file__).resolve().parent
    m=json.loads((directory/'validated-manifest.json').read_text());payload=(directory/'bridge.bin').read_bytes()
    if (m.get('schemaVersion'),m.get('operation'))!=(6,'early-armed-fixed-hello-only'):raise ValueError('wrong probe operation')
    if m.get('payloadBytes')!=len(payload) or m.get('payloadSha256')!=hashlib.sha256(payload).hexdigest():raise ValueError('payload digest/length mismatch')
    if not 8<len(payload)<0x1800 or struct.unpack_from('<II',payload)!=(0x20014000,0x20010009):raise ValueError('wrong SRAM layout')
    if set(m.get('sourceHashes',{}))!=set(SOURCES):raise ValueError('incomplete source provenance')
    for name,digest in m['sourceHashes'].items():
        if hashlib.sha256((root/name).read_bytes()).hexdigest()!=digest:raise ValueError(f'source changed: {name}')
    if m.get('route') not in ('left','right') or m.get('nominalBaud') not in (1000000,115200) or m.get('profile') not in PROFILES:raise ValueError('unsupported configuration')
    if (m.get('attempts'),m.get('receiveIntervalMs'),m.get('nominalReceiveWindowMs'))!=(20,400,8000):raise ValueError('wrong bounded schedule')
    if m.get('receiveMode')!='early-armed' or m.get('overrunReporting')!='enabled':raise ValueError('wrong receive mode')
    if m.get('templeCommandAllowlist')!=[HELLO.hex()] or any(m.get(key) is not False for key in ('templeResetImplemented','firmwareWriteImplemented','physicalResetClaimed','hardwareValidated')):
        raise ValueError('unexpected reset/write/hardware qualification capability')
    cases=m.get('cases',[])
    if len(cases)!=len(CASES) or {r.get('case') for r in cases}!=set(CASES) or not all(r.get('completed') is True for r in cases):raise ValueError('incomplete compiled coverage')
    return m,payload
