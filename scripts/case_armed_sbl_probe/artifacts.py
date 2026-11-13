"""Inspect immutable schema-12 armed-insertion probe artifacts offline."""
import json
from pathlib import Path

from case_armed_sbl_probe.build import SOURCES, generated_hook, sha
from case_armed_sbl_probe.validate import CASES
from case_native_task_recovery.build import encode_bl
from case_sbl_reset_prepared.trace import CASE_SHA256


def inspect_build(directory, reference):
    root = Path(__file__).resolve().parent
    manifest = json.loads((directory / "validated-manifest.json").read_text())
    stock = reference.read_bytes()[32:]
    if sha(stock) != CASE_SHA256 or manifest.get("stockCodeSha256") != CASE_SHA256:
        raise ValueError("wrong stock case code")
    if (manifest.get("schemaVersion"), manifest.get("operation")) != (
        12,
        "armed-insertion-native-pulse-sbl-hello",
    ):
        raise ValueError("wrong armed probe operation")
    expected_sources = {name: sha((root / name).read_bytes()) for name in SOURCES}
    expected_sources["generated-hook.c"] = sha(generated_hook())
    if manifest.get("sourceHashes") != expected_sources:
        raise ValueError("armed probe source provenance differs")
    artifacts = {name: (directory / f"{name}.bin").read_bytes() for name in ("hook", "trampoline", "patched-case")}
    for name, prefix in (("hook", "payload"), ("trampoline", "trampoline"), ("patched-case", "patchedCase")):
        if (manifest.get(prefix + "Bytes"), manifest.get(prefix + "Sha256")) != (
            len(artifacts[name]), sha(artifacts[name])
        ):
            raise ValueError("armed probe artifact identity differs")
    if not 0 < len(artifacts["hook"]) < 0x1800 or not 0 < len(artifacts["trampoline"]) <= 0x630:
        raise ValueError("armed probe storage bounds differ")
    expected = bytearray(stock + b"\xff" * (0xD9D0 - len(stock)) + artifacts["trampoline"])
    for site in (0x9AFA, 0x9B10):
        expected[site:site + 4] = encode_bl(0x08000000 + site, 0x0800D9D0)
    if artifacts["patched-case"] != bytes(expected):
        raise ValueError("armed probe changed bytes outside exact hook scope")
    rows = manifest.get("cases", [])
    if len(rows) != len(CASES) or {row.get("case") for row in rows} != set(CASES) or not all(row.get("passed") is True for row in rows):
        raise ValueError("armed probe emitted-code coverage incomplete")
    if (
        manifest.get("compiledValidationComplete") is not True
        or manifest.get("hardwareValidated") is not False
        or manifest.get("insertionWaitTicks") != 15000
        or manifest.get("caseBusyLockRequired") is not True
        or manifest.get("templeCommandAllowlist") != ["14559de900000800"]
        or manifest.get("maxTempleBytes") != 32
        or manifest.get("rtosTickReconfigured") is not False
        or manifest.get("glassesFirmwareWriteImplemented") is not False
    ):
        raise ValueError("armed probe capability/proof boundary differs")
    return manifest, artifacts
