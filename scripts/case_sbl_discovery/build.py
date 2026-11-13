#!/usr/bin/env python3
"""Compile and model-check a fixed discovery payload. Opens no hardware."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from g2_sbl_protocol import ENTRY_BIASES, BIAS_HOLD_MS, bias_configuration

PROFILES = {"reviewed-22": 0, "observed-33": 1, "observed-33-entry1": 2, "observed-45": 3}
SOURCES = ("bridge.c", "start.S", "link.ld", "validate.py", "build.py", "run.py", "artifacts.py", "../g2_sbl_protocol.py", "../g2_case_rom.py", "../g2_case_pogo_flasher.py")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--route", choices=("left", "right"), required=True)
    parser.add_argument("--baud", type=int, choices=(115200, 1000000), required=True)
    parser.add_argument("--profile", choices=tuple(PROFILES), required=True)
    parser.add_argument("--attempts", type=int, choices=(20, 4000), default=20)
    parser.add_argument("--entry-bias", choices=tuple(ENTRY_BIASES), default="none")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    args.output.mkdir(parents=True, exist_ok=True)
    source_hashes = {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in SOURCES}
    definitions = [f"-DROUTE_LEFT={int(args.route == 'left')}", f"-DUART_BRR={64 if args.baud == 1000000 else 556}", f"-DYHM_PROFILE={PROFILES[args.profile]}", f"-DHELLO_ATTEMPTS={args.attempts}"]
    pin, level = ENTRY_BIASES[args.entry_bias]
    definitions += [f"-DBIAS_PIN={pin}", f"-DBIAS_LEVEL={level}", f"-DBIAS_HOLD_MS={BIAS_HOLD_MS}"]
    for source in ("bridge.c", "start.S"):
        subprocess.run(["/usr/bin/clang", "--target=arm-none-eabi", "-mcpu=cortex-m0plus", "-mthumb", "-Os", "-ffreestanding", "-fno-builtin", "-Wall", "-Wextra", "-Werror", *definitions, "-c", str(root/source), "-o", str(args.output/(Path(source).stem + ".o"))], check=True)
    for name, extra in (("arm-none-eabi-ld", ["-T", str(root/"link.ld"), str(args.output/"start.o"), str(args.output/"bridge.o"), "-o", str(args.output/"bridge.elf")]), ("arm-none-eabi-objcopy", ["-O", "binary", str(args.output/"bridge.elf"), str(args.output/"bridge.bin")])):
        command = shutil.which(name)
        if not command:
            raise RuntimeError(f"missing {name}")
        subprocess.run([command, *extra], check=True)
    from validate import validate_payload
    payload = (args.output/"bridge.bin").read_bytes()
    if not 8 < len(payload) < 0x1800:
        raise RuntimeError("payload is outside the reserved SRAM code region")
    cases = validate_payload(payload, args.route, args.baud, args.profile, args.attempts, args.entry_bias)
    if source_hashes != {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in SOURCES}:
        raise RuntimeError("source changed during compilation/validation; rebuild required")
    manifest = {
        "schemaVersion": 2, "operation": "fixed-hello-discovery-only", "route": args.route,
        "entryBias": bias_configuration(args.entry_bias),
        "nominalBaud": args.baud, "profile": args.profile, "attempts": args.attempts,
        "receiveIntervalMs": 400 if args.attempts == 20 else 20,
        "nominalReceiveWindowMs": (400 if args.attempts == 20 else 20) * args.attempts, "physicalResetClaimed": False,
        "templeCommandAllowlist": ["14559de900000800"], "firmwareWriteImplemented": False,
        "payloadBytes": len(payload), "payloadSha256": hashlib.sha256(payload).hexdigest(),
        "sourceHashes": source_hashes,
        "cases": cases, "hardwareValidated": False,
    }
    (args.output/"validated-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({k: v for k, v in manifest.items() if k not in ("sourceHashes", "cases")}, indent=2))
    print(f"Compiled model validation: {len(cases)} cases passed")


if __name__ == "__main__":
    main()
