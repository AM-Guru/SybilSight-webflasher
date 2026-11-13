#!/usr/bin/env python3
"""Build the immutable schema-14 passive Even-bootloader log capture."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from case_native_task_recovery.build import encode_bl
from case_sbl_reset_prepared.trace import CASE_SHA256, fnv


ROOT = Path(__file__).resolve().parent
HELLO_ROOT = ROOT.parent / "case_native_task_hello"
SOURCES = (
    "build.py",
    "hook.c",
    "protocol.py",
    "validate.py",
    "runtime_validate.py",
    "artifacts.py",
    "../case_native_task_hello/hook.ld",
    "../case_native_task_hello/trampoline.c",
    "../case_native_task_hello/trampoline.ld",
    "../case_native_task_recovery/build.py",
    "../case_sbl_reset_prepared/trace.py",
    "../g2_even_bootlog.py",
)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case-reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")
    stock = args.case_reference.read_bytes()[32:]
    if sha(stock) != CASE_SHA256:
        raise ValueError("wrong stock case reference")
    frozen = {name: sha((ROOT / name).read_bytes()) for name in SOURCES}
    args.output.mkdir(parents=True)
    payload = None
    for name, source, linker in (
        ("hook", ROOT / "hook.c", HELLO_ROOT / "hook.ld"),
        ("trampoline", HELLO_ROOT / "trampoline.c", HELLO_ROOT / "trampoline.ld"),
    ):
        definitions = [] if name == "hook" else [
            f"-DPAYLOAD_BYTES={len(payload)}u", f"-DPAYLOAD_FNV={fnv(payload)}u"
        ]
        subprocess.run([
            "/usr/bin/clang", "--target=arm-none-eabi", "-mcpu=cortex-m0plus", "-mthumb",
            "-Os", "-ffreestanding", "-fno-builtin", "-Wall", "-Wextra", "-Werror",
            *definitions, "-c", str(source), "-o", str(args.output / f"{name}.o"),
        ], check=True)
        subprocess.run([
            "arm-none-eabi-ld", "-T", str(linker), str(args.output / f"{name}.o"),
            "-o", str(args.output / f"{name}.elf"),
        ], check=True)
        subprocess.run([
            "arm-none-eabi-objcopy", "-O", "binary", str(args.output / f"{name}.elf"),
            str(args.output / f"{name}.bin"),
        ], check=True)
        if name == "hook":
            payload = (args.output / "hook.bin").read_bytes()
    trampoline = (args.output / "trampoline.bin").read_bytes()
    patched = bytearray(stock + b"\xff" * (0xD9D0 - len(stock)) + trampoline)
    for site in (0x9AFA, 0x9B10):
        if stock[site:site + 4] != encode_bl(0x08000000 + site, 0x0800B678):
            raise ValueError("native reset call site differs")
        patched[site:site + 4] = encode_bl(0x08000000 + site, 0x0800D9D0)
    (args.output / "patched-case.bin").write_bytes(patched)
    from case_even_bootlog_capture.validate import validate
    cases = validate(stock, bytes(patched), payload, trampoline, (ROOT / "hook.c").read_text())
    from case_even_bootlog_capture.runtime_validate import validate_runtime
    runtime_cases = validate_runtime(payload)
    if frozen != {name: sha((ROOT / name).read_bytes()) for name in SOURCES}:
        raise ValueError("source changed during passive capture build")
    manifest = {
        "schemaVersion": 14,
        "operation": "armed-insertion-passive-even-bootloader-log-capture",
        "stockCodeSha256": CASE_SHA256,
        "sourceHashes": frozen,
        "payloadBytes": len(payload),
        "payloadSha256": sha(payload),
        "trampolineBytes": len(trampoline),
        "trampolineSha256": sha(trampoline),
        "patchedCaseBytes": len(patched),
        "patchedCaseSha256": sha(patched),
        "offlineValidationComplete": True,
        "compiledHookRuntimeFixtureComplete": True,
        "hardwareValidated": False,
        "insertionWaitTicks": 12000,
        "passiveCaptureTicks": 15000,
        "postPulseCaptureTicks": 3000,
        "captureClock": "systick-wrap-counter",
        "captureStartsBeforeInsertion": True,
        "retentionPolicy": "first-bytes-saturating",
        "retainedTempleBytes": 1020,
        "probeBaud": 1000000,
        "acceptedInitialUartBrr": [0, 64],
        "caseBusyLockRequired": True,
        "templeCommandAllowlist": [],
        "maxTempleBytesSent": 0,
        "rtosTickReconfigured": False,
        "glassesFirmwareWriteImplemented": False,
        "physicalApolloResetVerified": False,
        "cases": cases,
        "runtimeCases": runtime_cases,
        "boundary": (
            "Compiled storage and source capability, exact case patch scope, configuration, "
            "retention and parser fixtures are offline-validated. UART electrical behavior, "
            "the continuous pre-insertion capture, Apollo reset and bootloader execution remain physical gates."
        ),
    }
    (args.output / "validated-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Completed {len(cases)} passive bootlog cases; no hardware access.")


if __name__ == "__main__":
    main()
