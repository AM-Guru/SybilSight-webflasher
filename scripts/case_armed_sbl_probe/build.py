#!/usr/bin/env python3
"""Build an immutable schema-12 case probe with a locked insertion window."""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from case_native_task_recovery.build import encode_bl
from case_sbl_reset_prepared.trace import CASE_SHA256, fnv

ROOT = Path(__file__).resolve().parent
HELLO_ROOT = ROOT.parent / "case_native_task_hello"
SOURCES = (
    "build.py",
    "protocol.py",
    "validate.py",
    "artifacts.py",
    "../case_native_task_hello/hook.c",
    "../case_native_task_hello/hook.ld",
    "../case_native_task_hello/trampoline.c",
    "../case_native_task_hello/trampoline.ld",
    "../case_native_task_hello/validate.py",
    "../case_native_task_recovery/build.py",
    "../case_sbl_reset_prepared/trace.py",
    "../g2_sbl_protocol.py",
)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def generated_hook():
    source = (HELLO_ROOT / "hook.c").read_text()
    replacements = {
        "BOUNDED_OUT,STCTRL0": "WAIT_DONE,STCTRL0",
        "O(BOUNDED_OUT)=1;return 0;": "O(FLAGS)|=8u;return 0;",
        "CFG[2]!=11": "CFG[2]!=12",
        "O(SCHEMA)=11;": "O(SCHEMA)=12;",
        "O(UART0+3)!=64": "(O(UART0+3)!=0 && O(UART0+3)!=64)",
        "CFG[6]!=20": "CFG[6]!=4",
        "for(uint32_t a=0;a<20;a++)": "for(uint32_t a=0;a<4;a++)",
        "if(a+1<20)": "if(a+1<4)",
    }
    for old, new in replacements.items():
        if source.count(old) != 1:
            raise ValueError(f"base HELLO source anchor differs: {old}")
        source = source.replace(old, new)
    anchor = "static uint32_t primask(void){uint32_t v;__asm__ volatile(\"mrs %0, primask\":\"=r\"(v));return v;}"
    wait = anchor + "\n" + r'''static uint32_t insertion_wait(void) {
 uint32_t start=tick();
 for(uint32_t n=0;n<200000000u;n++) {
  uint32_t now=tick();
  if((uint32_t)(now-start)>=15000u)return 1;
  if((n&65535u)==0) {
   R(0x40003000u)=0xaaaau;
   if(ipsr() || primask() || scheduler()!=2 || *(volatile uint8_t*)(uintptr_t)0x200000bcu!=1)return 0;
  }
 }
 return 0;
}'''
    if source.count(anchor) != 1:
        raise ValueError("base HELLO primask anchor differs")
    source = source.replace(anchor, wait)
    old = "O(FLAGS)|=1;O(STAGE)=2;O(TICK0)=tick();pulse();O(TICK_PULSE)=tick();O(STAGE)=3;\n uint32_t latch=R(B+20)&0x300u;"
    new = "O(FLAGS)|=1;O(STAGE)=2;O(TICK0)=tick();\n uint32_t latch=R(B+20)&0x300u;\n if(!insertion_wait()){O(STATUS)=10;goto cleanup;}\n O(WAIT_DONE)=tick();pulse();O(TICK_PULSE)=tick();O(STAGE)=3;"
    if source.count(old) != 1:
        raise ValueError("base HELLO pulse anchor differs")
    return source.replace(old, new).encode()


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
    source = generated_hook()
    args.output.mkdir(parents=True)
    (args.output / "generated-hook.c").write_bytes(source)
    frozen["generated-hook.c"] = sha(source)
    payload = None
    for name, source_path, linker in (
        ("hook", args.output / "generated-hook.c", HELLO_ROOT / "hook.ld"),
        ("trampoline", HELLO_ROOT / "trampoline.c", HELLO_ROOT / "trampoline.ld"),
    ):
        definitions = [] if name == "hook" else [
            f"-DPAYLOAD_BYTES={len(payload)}u",
            f"-DPAYLOAD_FNV={fnv(payload)}u",
        ]
        subprocess.run([
            "/usr/bin/clang", "--target=arm-none-eabi", "-mcpu=cortex-m0plus", "-mthumb",
            "-Os", "-ffreestanding", "-fno-builtin", "-Wall", "-Wextra", "-Werror",
            *definitions, "-c", str(source_path), "-o", str(args.output / f"{name}.o"),
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
    manifest = {
        "schemaVersion": 12,
        "operation": "armed-insertion-native-pulse-sbl-hello",
        "stockCodeSha256": CASE_SHA256,
        "sourceHashes": frozen,
        "payloadBytes": len(payload),
        "payloadSha256": sha(payload),
        "trampolineBytes": len(trampoline),
        "trampolineSha256": sha(trampoline),
        "patchedCaseBytes": len(patched),
        "patchedCaseSha256": sha(patched),
        "compiledValidationComplete": False,
        "hardwareValidated": False,
        "insertionWaitTicks": 15000,
        "caseBusyLockRequired": True,
        "templeCommandAllowlist": ["14559de900000800"],
        "maxTempleBytes": 32,
        "rtosTickReconfigured": False,
        "glassesFirmwareWriteImplemented": False,
        "cases": [],
    }
    from case_armed_sbl_probe.validate import validate
    try:
        manifest["cases"] = list(validate(args.case_reference.read_bytes(), bytes(patched), payload))
        if frozen != ({name: sha((ROOT / name).read_bytes()) for name in SOURCES} | {"generated-hook.c": sha(generated_hook())}):
            raise ValueError("source changed during schema-12 validation")
        manifest["compiledValidationComplete"] = True
    finally:
        (args.output / "validated-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Completed {len(manifest['cases'])} armed-insertion cases; no hardware access.")


if __name__ == "__main__":
    main()
