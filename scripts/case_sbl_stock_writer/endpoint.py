"""Bind one schema-12 armed probe to an exact physical SBL STATUS frame."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from case_armed_sbl_probe.protocol import decode
from case_native_task_flash.build import CASE_SERIAL


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def inspect_target_probe(
    output: Path,
    route: str,
    *,
    expected_audit_sha256: str,
    expected_status_sha256: str,
) -> dict[str, object]:
    if route not in ("left", "right"):
        raise ValueError("target route must be left or right")
    output = Path(output)
    audit_bytes = (output / "audit.json").read_bytes()
    if _sha(audit_bytes) != expected_audit_sha256.lower():
        raise ValueError("target probe audit SHA-256 differs")
    audit = json.loads(audit_bytes)
    raw = (output / f"armed-sbl-{route}-result.bin").read_bytes()
    result = decode(raw)
    frames = result["discovery"]["statusFrames"]
    transaction = audit.get("transaction", {})
    if (
        audit.get("operation") != "schema12-armed-insertion-sbl-probe"
        or audit.get("schemaVersion") != 12
        or audit.get("caseSerial") != CASE_SERIAL
        or audit.get("outcome") != "armed-sbl-status-observed-stock-restored"
        or audit.get("validSblStatusFrames") != 1
        or audit.get("sblEndpointVerified") is not True
        or audit.get("templeFirmwareImageBytes") != 0
        or audit.get("physicalApolloResetVerified") is not False
        or transaction.get("fullStockVerified") is not True
        or transaction.get("sramRestored") is not True
        or transaction.get("stockBooted") is not True
        or transaction.get("restoreErrors") != []
        or audit.get("stockVersionRestored") != "1.2.57"
        or result.get("probeQualified") is not True
        or result.get("route") != route
        or audit.get("probeBaud") not in (115_200, 1_000_000)
        or result.get("brr") != (556 if audit.get("probeBaud") == 115_200 else 64)
        or len(frames) != 1
    ):
        raise ValueError("target probe or Case restoration is not qualified")
    current_sources = {
        name: _sha(Path(name).read_bytes())
        for name in audit.get("sourceHashes", {})
    }
    if not current_sources or current_sources != audit.get("sourceHashes"):
        raise ValueError("target probe source or input changed after execution")
    status = bytes.fromhex(frames[0]["frameHex"])
    if len(status) != 96 or _sha(status) != expected_status_sha256.lower():
        raise ValueError("target STATUS frame SHA-256 differs")
    return {
        "operation": "schema13-target-sbl-endpoint-binding",
        "route": route,
        "caseSerial": CASE_SERIAL,
        "probeOutput": str(output.resolve()),
        "probeAuditSha256": _sha(audit_bytes),
        "probeResultSha256": _sha(raw),
        "statusFrame": status,
        "statusFrameSha256": _sha(status),
        "status": frames[0],
        "probeBaud": audit["probeBaud"],
        "physicalApolloResetVerified": False,
        "firmwareWriteAuthorized": False,
        "boundary": (
            "Binds a responding CRC-valid SBL endpoint and restored Case route. "
            "It does not prove retail write policy or stock recovery."
        ),
    }


__all__ = ["inspect_target_probe"]
