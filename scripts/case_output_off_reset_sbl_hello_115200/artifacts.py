"""Fail-closed inspection of schema-18 exact Case hook artifacts."""

import json

from case_output_off_reset_sbl_hello_115200.build import SOURCES, sha
from case_native_task_recovery.build import encode_bl
from case_sbl_reset_prepared.trace import CASE_SHA256


def inspect(directory, reference):
    manifest = json.loads((directory / "validated-manifest.json").read_text())
    stock = reference.read_bytes()[32:]
    if sha(stock) != CASE_SHA256 or manifest.get("stockCaseCodeSha256") != CASE_SHA256:
        raise ValueError("wrong stock Case reference")
    if (manifest.get("schemaVersion"), manifest.get("operation")) != (
        18, "seated-stock-case-yhm-off-reset-sbl-hello-115200-uart-capture"
    ):
        raise ValueError("wrong off-reset-sbl-hello-115200 operation")
    if manifest.get("sourceHashes") != {str(path): sha(path.read_bytes()) for path in SOURCES}:
        raise ValueError("off-reset-sbl-hello-115200 source changed since build")
    artifacts = {name: (directory / f"{name}.bin").read_bytes()
                 for name in ("hook", "trampoline", "patched-case")}
    for name, prefix in (("hook", "hook"), ("trampoline", "trampoline"),
                         ("patched-case", "patchedCase")):
        if (manifest.get(prefix + "Bytes"), manifest.get(prefix + "Sha256")) != (
            len(artifacts[name]), sha(artifacts[name])
        ):
            raise ValueError("off-reset-sbl-hello-115200 artifact identity changed")
    patched = bytearray(stock + b"\xff" * (0xD9D0 - len(stock)) + artifacts["trampoline"])
    for site in (0x9AFA, 0x9B10):
        patched[site:site + 4] = encode_bl(0x08000000 + site, 0x0800D9D0)
    if artifacts["patched-case"] != bytes(patched):
        raise ValueError("off-reset-sbl-hello-115200 patch changed bytes outside exact hook scope")
    if (manifest.get("runtimeCasesPassed") != 11
            or manifest.get("hardwareValidated") is not False
            or manifest.get("stockOutputOffPrecondition") is not True
            or manifest.get("stockOutputOnCleanupRequired") is not True
            or manifest.get("templeTransmitBytes") != 160
            or manifest.get("templeCommandAllowlist") != ["14559de900000800"]
            or manifest.get("fixedHelloAttempts") != 20):
        raise ValueError("off-reset-sbl-hello-115200 capability boundary changed")
    return manifest, artifacts
