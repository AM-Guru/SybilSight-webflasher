"""Inspect immutable schema-14 passive capture artifacts without device access."""

import json
from pathlib import Path

from case_even_bootlog_capture.build import ROOT, SOURCES, sha
from case_native_task_recovery.build import encode_bl
from case_sbl_reset_prepared.trace import CASE_SHA256


def inspect(directory, reference):
    manifest = json.loads((directory / "validated-manifest.json").read_text())
    stock = reference.read_bytes()[32:]
    if sha(stock) != CASE_SHA256 or manifest.get("stockCodeSha256") != CASE_SHA256:
        raise ValueError("wrong passive capture stock reference")
    if (manifest.get("schemaVersion"), manifest.get("operation")) != (
        14, "armed-insertion-passive-even-bootloader-log-capture"
    ):
        raise ValueError("wrong passive capture operation")
    expected_sources = {name: sha((ROOT / name).read_bytes()) for name in SOURCES}
    if manifest.get("sourceHashes") != expected_sources:
        raise ValueError("passive capture source provenance differs")
    artifacts = {
        name: (directory / f"{name}.bin").read_bytes()
        for name in ("hook", "trampoline", "patched-case")
    }
    for name, prefix in (("hook", "payload"), ("trampoline", "trampoline"), ("patched-case", "patchedCase")):
        if (manifest.get(prefix + "Bytes"), manifest.get(prefix + "Sha256")) != (
            len(artifacts[name]), sha(artifacts[name])
        ):
            raise ValueError("passive capture artifact identity differs")
    expected = bytearray(stock + b"\xff" * (0xD9D0 - len(stock)) + artifacts["trampoline"])
    for site in (0x9AFA, 0x9B10):
        expected[site:site + 4] = encode_bl(0x08000000 + site, 0x0800D9D0)
    if artifacts["patched-case"] != bytes(expected):
        raise ValueError("passive capture changed bytes outside exact hook scope")
    if (
        manifest.get("offlineValidationComplete") is not True
        or manifest.get("compiledHookRuntimeFixtureComplete") is not True
        or manifest.get("hardwareValidated") is not False
        or manifest.get("templeCommandAllowlist") != []
        or manifest.get("maxTempleBytesSent") != 0
        or manifest.get("retainedTempleBytes") != 1020
        or manifest.get("probeBaud") != 1_000_000
        or manifest.get("acceptedInitialUartBrr") != [0, 64]
        or manifest.get("captureStartsBeforeInsertion") is not True
        or manifest.get("insertionWaitTicks") != 12_000
        or manifest.get("passiveCaptureTicks") != 15_000
        or manifest.get("postPulseCaptureTicks") != 3_000
        or manifest.get("captureClock") != "systick-wrap-counter"
        or manifest.get("retentionPolicy") != "first-bytes-saturating"
        or manifest.get("glassesFirmwareWriteImplemented") is not False
        or len(manifest.get("cases", [])) != 11
        or len(manifest.get("runtimeCases", [])) != 6
        or not all(row.get("passed") is True for row in manifest["cases"])
        or not all(row.get("passed") is True for row in manifest["runtimeCases"])
    ):
        raise ValueError("passive capture capability/proof boundary differs")
    return manifest, artifacts
