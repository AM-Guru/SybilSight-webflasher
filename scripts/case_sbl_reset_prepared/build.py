#!/usr/bin/env python3
"""Build a fixed stock-reset/HELLO SRAM probe and exercise its emitted code."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from case_sbl_reset_prepared.trace import extract, header
from case_sbl_reset_prepared.protocol import PROFILES
from case_sbl_reset_prepared.waveforms import WAVEFORM_CODES, derive

SOURCES = ("bridge.c", "start.S", "link.ld", "trace.py", "waveforms.py", "protocol.py", "build.py",
    "validate.py", "artifacts.py", "run.py", "../g2_sbl_protocol.py", "../g2_stock_case_diagnostics.py", "../g2_pogo_protocol.py",
    "../case_sbl_discovery/run.py", "../case_sbl_discovery/artifacts.py",
    "../case_sbl_discovery/build.py", "../case_sbl_discovery/validate.py",
    "../g2_case_rom.py", "../g2_case_pogo_flasher.py")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--case-reference", type=Path, required=True)
    p.add_argument("--route", choices=("left", "right"), required=True)
    p.add_argument("--baud", type=int, choices=(115200, 1_000_000), required=True)
    p.add_argument("--profile", choices=tuple(PROFILES), default="observed-33-entry1")
    p.add_argument("--forced-strap", choices=("none", "pb8-low", "pb8-high"), default="none")
    p.add_argument("--power-cycle", choices=("none", "route-ae-af"), default="none")
    p.add_argument("--waveform", choices=tuple(WAVEFORM_CODES), default="stock")
    a = p.parse_args()
    root = Path(__file__).resolve().parent
    a.output.mkdir(parents=True, exist_ok=True)
    frozen = {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in SOURCES}
    trace = derive(extract(a.case_reference.read_bytes()), a.waveform)
    (a.output/"reset_actions.h").write_text(header(trace))
    (a.output/"reset-trace.json").write_text(json.dumps(trace, indent=2)+"\n")
    strap_pin = 0 if a.forced_strap == "none" else 8
    strap_level = int(a.forced_strap == "pb8-high")
    definitions = [f"-DROUTE_LEFT={int(a.route=='left')}",f"-DUART_BRR={64 if a.baud==1_000_000 else 556}",f"-DYHM_PROFILE={PROFILES[a.profile]}",f"-DFORCE_STRAP_PIN={strap_pin}",f"-DFORCE_STRAP_LEVEL={strap_level}",f"-DPOWER_CYCLE={int(a.power_cycle!='none')}",f"-DWAVEFORM_CODE={WAVEFORM_CODES[a.waveform]}"]
    for source in ("bridge.c", "start.S"):
        subprocess.run(["/usr/bin/clang","--target=arm-none-eabi","-mcpu=cortex-m0plus","-mthumb","-Os",
            "-ffreestanding","-fno-builtin","-Wall","-Wextra","-Werror",*definitions,"-I",str(a.output),
            "-c",str(root/source),"-o",str(a.output/(Path(source).stem+".o"))],check=True)
    subprocess.run(["arm-none-eabi-ld","-T",str(root/"link.ld"),str(a.output/"start.o"),str(a.output/"bridge.o"),"-o",str(a.output/"bridge.elf")],check=True)
    subprocess.run(["arm-none-eabi-objcopy","-O","binary",str(a.output/"bridge.elf"),str(a.output/"bridge.bin")],check=True)
    payload = (a.output/"bridge.bin").read_bytes()
    if not 8 < len(payload) < 0x1800:
        raise ValueError("payload exceeds SRAM region")
    from case_sbl_reset_prepared.validate import validate_payload
    cases = validate_payload(payload,a.route,a.baud,a.profile,20,trace=trace,forced_strap=a.forced_strap,power_cycle=a.power_cycle)
    if frozen != {name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in SOURCES}:
        raise ValueError("source changed during build")
    manifest = {"schemaVersion":8,"operation":"prepared-uart-stock-reset-early-hello",
        "receiveMode":"early-armed","overrunReporting":"enabled",
        "nativeUartSetupAfterTrain":False,"maxReleaseToFirstTdrCycles":64000,
        "route":a.route,"nominalBaud":a.baud,"profile":a.profile,"attempts":20,
        "forcedStrap":a.forced_strap,
        "waveform":a.waveform,
        "powerCycle":a.power_cycle,"powerOffMs":3000 if a.power_cycle!="none" else 0,
        "powerSettleMs":50 if a.power_cycle!="none" else 0,
        "powerCycleClaimsApolloReset":False,
        "receiveIntervalMs":400,"nominalReceiveWindowMs":8000,"resetTrace":trace,
        "templeCommandAllowlist":["14559de900000800"],"firmwareWriteImplemented":False,
        "physicalResetClaimed":False,"hardwareValidated":False,
        "payloadBytes":len(payload),"payloadSha256":hashlib.sha256(payload).hexdigest(),
        "sourceHashes":frozen,"cases":cases}
    (a.output/"validated-manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print(json.dumps({"payloadBytes":len(payload),"compiledCasesPassed":len(cases),"output":str(a.output)},indent=2))


if __name__ == "__main__":
    main()
