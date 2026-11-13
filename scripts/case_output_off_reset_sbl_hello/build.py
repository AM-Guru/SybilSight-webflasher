#!/usr/bin/env python3
"""Build the schema-17 seated YHM-edge receiver without touching hardware."""

import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from capstone import Cs, CS_ARCH_ARM, CS_MODE_MCLASS, CS_MODE_THUMB
from case_native_task_recovery.build import encode_bl
from case_sbl_reset_prepared.trace import CASE_SHA256, fnv
from case_output_off_reset_sbl_hello.protocol import configuration
from case_output_off_reset_sbl_hello.runtime_validate import validate_runtime


ROOT = Path(__file__).resolve().parent
HELLO = ROOT.parent / "case_native_task_hello"
SOURCES = (
    ROOT / "build.py", ROOT / "hook.c", ROOT / "protocol.py",
    ROOT / "runtime_validate.py", HELLO / "hook.ld", HELLO / "trampoline.c",
    HELLO / "trampoline.ld", ROOT.parent / "g2_sbl_protocol.py",
    ROOT.parent / "case_native_task_recovery/build.py",
    ROOT.parent / "case_sbl_reset_prepared/trace.py",
)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def compile_one(name: str, source: Path, linker: Path, output: Path, definitions=()) -> bytes:
    obj = output / f"{name}.o"
    elf = output / f"{name}.elf"
    binary = output / f"{name}.bin"
    subprocess.run([
        "/usr/bin/clang", "--target=arm-none-eabi", "-mcpu=cortex-m0plus", "-mthumb",
        "-Os", "-ffreestanding", "-fno-builtin", "-Wall", "-Wextra", "-Werror",
        *definitions, "-c", str(source), "-o", str(obj),
    ], check=True)
    subprocess.run(["arm-none-eabi-ld", "-T", str(linker), str(obj), "-o", str(elf)], check=True)
    subprocess.run(["arm-none-eabi-objcopy", "-O", "binary", str(elf), str(binary)], check=True)
    return binary.read_bytes()


def build(case_reference: Path, output: Path) -> dict[str, object]:
    if output.exists():
        raise ValueError("build output must be fresh")
    stock = case_reference.read_bytes()[32:]
    if sha(stock) != CASE_SHA256:
        raise ValueError("wrong stock Case reference")
    frozen = {str(path): sha(path.read_bytes()) for path in SOURCES}
    output.mkdir(parents=True)
    hook = compile_one("hook", ROOT / "hook.c", HELLO / "hook.ld", output)
    if not 0 < len(hook) < 0x1800 or len(hook) % 4:
        raise ValueError("hook exceeds exact SRAM range")
    disasm = list(Cs(CS_ARCH_ARM, CS_MODE_THUMB | CS_MODE_MCLASS).disasm(hook, 0x20010000))
    if not disasm or disasm[0].address != 0x20010000:
        raise ValueError("compiled hook did not disassemble at its SRAM entry")
    source = (ROOT / "hook.c").read_text()
    if (source.count("R(U+40)=hello[j]") != 1
            or "const uint8_t hello[8]={0x14,0x55,0x9d,0xe9,0,0,8,0}" not in source
            or "O(TX)<160u" not in source or "R(U)=5" not in source):
        raise ValueError("hook fixed HELLO allowlist or RX path changed")
    trampoline = compile_one(
        "trampoline", HELLO / "trampoline.c", HELLO / "trampoline.ld", output,
        (f"-DPAYLOAD_BYTES={len(hook)}u", f"-DPAYLOAD_FNV={fnv(hook)}u"),
    )
    patched = bytearray(stock + b"\xff" * (0xD9D0 - len(stock)) + trampoline)
    for site in (0x9AFA, 0x9B10):
        if stock[site:site + 4] != encode_bl(0x08000000 + site, 0x0800B678):
            raise ValueError("native Case reset call site differs")
        patched[site:site + 4] = encode_bl(0x08000000 + site, 0x0800D9D0)
    (output / "patched-case.bin").write_bytes(patched)
    for route in ("left", "right"):
        words = struct.unpack("<8I", configuration(route, 0x11223344))
        if words[2:7] != (17, int(route == "right"), 64, 0x11223344, 15000):
            raise ValueError("schema-17 configuration differs")
    runtime_cases = validate_runtime(hook)
    if frozen != {str(path): sha(path.read_bytes()) for path in SOURCES}:
        raise ValueError("source changed during build")
    manifest = {
        "schemaVersion": 17,
        "operation": "seated-stock-case-yhm-off-reset-sbl-hello-uart-capture",
        "stockCaseCodeSha256": CASE_SHA256,
        "sourceHashes": frozen,
        "hookBytes": len(hook), "hookSha256": sha(hook),
        "trampolineBytes": len(trampoline), "trampolineSha256": sha(trampoline),
        "patchedCaseBytes": len(patched), "patchedCaseSha256": sha(patched),
        "runtimeCasesPassed": len(runtime_cases),
        "runtimeCases": [{"case": row["case"], "passed": row["passed"]} for row in runtime_cases],
        "templeTransmitBytes": 160,
        "templeCommandAllowlist": ["14559de900000800"],
        "fixedHelloAttempts": 20,
        "stockOutputOffPrecondition": True,
        "stockOutputOnCleanupRequired": True,
        "yhmSequence": "selected 3/4 AE, native pulse, AF, AE; stock output flag remains off until host cleanup",
        "capturedSystickWraps": 15000,
        "hardwareValidated": False,
        "physicalPogoVoltageMeasured": False,
        "apolloResetVerified": False,
        "boundary": "Compiled hook and explicit Unicorn fixtures validate sequencing and cleanup paths only. The fixture models the YHM setter, UART input, timer and PB9; it does not prove physical voltage, temple output or Apollo reset.",
    }
    (output / "validated-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case-reference", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = build(args.case_reference, args.output)
    print(f"Built {report['hookBytes']} byte hook; {report['runtimeCasesPassed']} compiled runtime cases passed; no hardware access.")


if __name__ == "__main__":
    main()
