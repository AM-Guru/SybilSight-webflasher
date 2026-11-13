#!/usr/bin/env python3
"""Build and fault-check a fixed application-version UART control."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from case_uart_version_control.protocol import PROFILES, fnv, POGO_REQUESTS, RECEIVE_MODES
from g2_stock_case_diagnostics import VERSION_REQUESTS

SOURCES = ("bridge.c", "start.S", "link.ld", "protocol.py", "build.py",
    "validate.py", "artifacts.py", "run.py", "../g2_sbl_protocol.py", "../g2_stock_case_diagnostics.py", "../g2_pogo_protocol.py",
    "../case_sbl_discovery/run.py", "../case_sbl_discovery/artifacts.py",
    "../case_sbl_discovery/build.py", "../case_sbl_discovery/validate.py",
    "../g2_case_rom.py", "../g2_case_pogo_flasher.py")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--route", choices=("left", "right"), required=True)
    p.add_argument("--receive-mode", choices=tuple(RECEIVE_MODES), default='native-turnaround')
    p.add_argument("--profile", choices=tuple(PROFILES), default="observed-33-entry1")
    a = p.parse_args()
    root = Path(__file__).resolve().parent
    a.output.mkdir(parents=True, exist_ok=True)
    frozen = {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in SOURCES}
    definitions = [f"-DROUTE_LEFT={int(a.route=='left')}","-DUART_BRR=64",f"-DYHM_PROFILE={PROFILES[a.profile]}",f"-DREQUEST_FNV={fnv(POGO_REQUESTS[a.route])}u"]
    definitions.append(f'-DEARLY_RX={RECEIVE_MODES[a.receive_mode]}')
    for source in ("bridge.c", "start.S"):
        subprocess.run(["/usr/bin/clang","--target=arm-none-eabi","-mcpu=cortex-m0plus","-mthumb","-Os",
            "-ffreestanding","-fno-builtin","-Wall","-Wextra","-Werror",*definitions,"-I",str(a.output),
            "-c",str(root/source),"-o",str(a.output/(Path(source).stem+".o"))],check=True)
    subprocess.run(["arm-none-eabi-ld","-T",str(root/"link.ld"),str(a.output/"start.o"),str(a.output/"bridge.o"),"-o",str(a.output/"bridge.elf")],check=True)
    subprocess.run(["arm-none-eabi-objcopy","-O","binary",str(a.output/"bridge.elf"),str(a.output/"bridge.bin")],check=True)
    payload = (a.output/"bridge.bin").read_bytes()
    if not 8 < len(payload) < 0x1800:
        raise ValueError("payload exceeds SRAM region")
    from case_uart_version_control.validate import validate_payload
    cases = validate_payload(payload,a.route,1000000,a.profile,1,receive_mode=a.receive_mode)
    if frozen != {name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in SOURCES}:
        raise ValueError("source changed during build")
    manifest = {"schemaVersion":5,"operation":"fixed-app-version-uart-control",
        "receiveMode":a.receive_mode,"overrunReporting":"enabled",
        "route":a.route,"nominalBaud":1000000,"profile":a.profile,"attempts":1,
        "receiveIntervalMs":400,"nominalReceiveWindowMs":400,"templeResetImplemented":False,
        "templeCommandAllowlist":[POGO_REQUESTS[a.route].hex()],"firmwareWriteImplemented":False,
        "physicalResetClaimed":False,"hardwareValidated":False,
        "payloadBytes":len(payload),"payloadSha256":hashlib.sha256(payload).hexdigest(),
        "sourceHashes":frozen,"cases":cases}
    (a.output/"validated-manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print(json.dumps({"payloadBytes":len(payload),"compiledCasesPassed":len(cases),"output":str(a.output)},indent=2))


if __name__ == "__main__":
    main()
