#!/usr/bin/env python3
"""Run one evidence-bound schema-13 stock recovery and verify app liveness."""
from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from case_sbl_stock_writer.artifacts import inspect as inspect_bridge
from case_sbl_stock_writer.endpoint import inspect_target_probe
from case_sbl_stock_writer.stock_release import expected_stock_version
from case_sbl_stock_writer.transport import Schema13CaseTransport
from g2_case_pogo_flasher import CaseSramTempleTransport, REVIEWED_CASE_VERSION
from g2_pogo_flasher import MainFirmwareFlasher
from g2_sbl_wire import qualify_stock_update
from g2_sbl_writer import (
    DEVICE_RISK_TOKEN,
    FIRMWARE_RISK_TOKEN,
    SblWriteFailure,
    run_stock_update,
)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class QualifiedExecutionFailure(RuntimeError):
    def __init__(self, message: str, execution_result: dict[str, object]):
        super().__init__(message)
        self.execution_result = execution_result


def postflight_stock_liveness(
    device: str, route: str, *, expected_version: str, attempts: int = 12
) -> dict[str, object]:
    rows = []
    for attempt in range(1, attempts + 1):
        transport = None
        row: dict[str, object] = {"attempt": attempt}
        try:
            transport = CaseSramTempleTransport(device, route)
            version = MainFirmwareFlasher(transport).read_version()
            row["version"] = asdict(version)
        except Exception as error:
            row["error"] = str(error)
        finally:
            if transport is not None:
                transport.close()
                row["caseRestoreVerified"] = transport.restore_verified
                row["caseApplicationVersion"] = transport.application_version
                if transport.close_error:
                    row["caseRestoreError"] = transport.close_error
        rows.append(row)
        if row.get("caseRestoreError"):
            raise RuntimeError(f"postflight Case restoration failed: {row}")
        if transport is not None and (
            row.get("caseRestoreVerified") is not True
            or row.get("caseApplicationVersion") != REVIEWED_CASE_VERSION
        ):
            raise RuntimeError(f"postflight Case restoration proof is incomplete: {row}")
        version = row.get("version")
        if version is not None:
            if version.get("firmware") != expected_version or version.get("hardware") != 5:
                raise RuntimeError(f"postflight returned unexpected identity: {version}")
            return {
                "passed": True,
                "attempts": rows,
                "firmware": version["firmware"],
                "hardware": version["hardware"],
                "versionIsLivenessNotStandaloneImageProvenance": True,
            }
        if attempt != attempts:
            time.sleep(5.0)
    raise RuntimeError(f"stock liveness absent after {attempts} read-only attempts: {rows}")


def execute_qualified(
    *,
    device: str,
    route: str,
    build: Path,
    stock_image: Path,
    image: bytes,
    image_sha256: str,
    status_frame: bytes,
    baud: int,
    bridge_sha256: str,
    device_risk_token: str,
    firmware_risk_token: str,
    transport_class=Schema13CaseTransport,
    writer=run_stock_update,
    postflight=postflight_stock_liveness,
) -> dict[str, object]:
    expected_version = expected_stock_version(image_sha256)
    transport = None
    result: dict[str, object] = {
        "write": None,
        "caseRestoreVerified": False,
        "caseApplicationVersion": None,
        "postflight": None,
        "targetStockApplicationResponsive": False,
        "glassesRecovered": False,
    }
    write_error = None
    try:
        transport = transport_class(
            device,
            route,
            build=build,
            stock_image=stock_image,
            baud=baud,
            expected_bridge_sha256=bridge_sha256,
            device_risk_token=device_risk_token,
            firmware_risk_token=firmware_risk_token,
        )
        result["write"] = writer(
            transport,
            image,
            expected_image_sha256=image_sha256,
            expected_status_frame=status_frame,
            expected_route=route,
            device_risk_token=device_risk_token,
            firmware_risk_token=firmware_risk_token,
        )
    except SblWriteFailure as error:
        result["write"] = error.audit
        write_error = error
    finally:
        if transport is not None:
            transport.close()
            result["caseRestoreVerified"] = transport.restore_verified
            result["caseApplicationVersion"] = transport.application_version
            result["caseRestoreError"] = transport.close_error
    if write_error is not None:
        write_error.execution_result = result
        raise write_error
    try:
        if result.get("caseRestoreError"):
            raise RuntimeError(f"schema-13 Case restoration failed: {result['caseRestoreError']}")
        if (
            result["caseRestoreVerified"] is not True
            or result["caseApplicationVersion"] != REVIEWED_CASE_VERSION
        ):
            raise RuntimeError("schema-13 Case restoration proof is incomplete")
        result["postflight"] = postflight(
            device, route, expected_version=expected_version
        )
        if result["postflight"].get("passed") is not True:
            raise RuntimeError("postflight stock application liveness was not verified")
        result["targetStockApplicationResponsive"] = True
    except Exception as error:
        raise QualifiedExecutionFailure(str(error), result) from error
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    parser.add_argument("--route", choices=("left", "right"), required=True)
    for name in ("build", "stock-image", "probe-output", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    for name in (
        "image-sha256", "bridge-sha256", "probe-audit-sha256", "status-sha256",
        "device-risk-token", "firmware-risk-token",
    ):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--execute-stock-write", action="store_true", required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")
    if (
        args.device_risk_token != DEVICE_RISK_TOKEN
        or args.firmware_risk_token != FIRMWARE_RISK_TOKEN
    ):
        parser.error("both exact operator risk tokens are required")

    image = args.stock_image.read_bytes()
    if _sha(image) != args.image_sha256.lower():
        parser.error("stock image SHA-256 differs")
    expected_version = expected_stock_version(args.image_sha256)
    endpoint = inspect_target_probe(
        args.probe_output,
        args.route,
        expected_audit_sha256=args.probe_audit_sha256,
        expected_status_sha256=args.status_sha256,
    )
    manifest, bridge = inspect_bridge(
        args.build, args.stock_image, expected_baud=endpoint["probeBaud"]
    )
    if _sha(bridge) != args.bridge_sha256.lower():
        parser.error("schema-13 bridge SHA-256 differs")
    qualification = qualify_stock_update(
        image, endpoint["statusFrame"], expected_sha256=args.image_sha256
    )
    if qualification["capacityAccepted"] is not True:
        parser.error("target SBL capacity is insufficient")

    sources = [
        Path(__file__),
        Path(__file__).resolve().parent / "artifacts.py",
        Path(__file__).resolve().parent / "endpoint.py",
        Path(__file__).resolve().parent / "transport.py",
        Path(__file__).resolve().parent / "stock_release.py",
        Path(__file__).resolve().parents[1] / "g2_sbl_writer.py",
        Path(__file__).resolve().parents[1] / "g2_sbl_wire.py",
        args.build / "validated-manifest.json",
        args.build / "bridge.bin",
        args.build / "validator.bin",
        args.stock_image,
        args.probe_output / "audit.json",
        args.probe_output / f"armed-sbl-{args.route}-result.bin",
    ]
    frozen = {str(path.resolve()): _sha(path.read_bytes()) for path in sources}
    args.output.mkdir(parents=True)
    report: dict[str, object] = {
        "operation": "schema13-evidence-bound-stock-sbl-recovery",
        "schemaVersion": 13,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "device": args.device,
        "route": args.route,
        "sourceHashes": frozen,
        "endpoint": {key: value for key, value in endpoint.items() if key != "statusFrame"},
        "qualification": qualification,
        "expectedStockFirmwareVersion": expected_version,
        "bridgeManifest": manifest,
        "write": None,
        "firmwareImageBytesAttempted": 0,
        "targetStockApplicationResponsive": False,
        "glassesRecovered": False,
        "outcome": "not-started",
    }
    return_code = 2
    try:
        executed = execute_qualified(
            device=args.device,
            route=args.route,
            build=args.build,
            stock_image=args.stock_image,
            image=image,
            image_sha256=args.image_sha256,
            status_frame=endpoint["statusFrame"],
            baud=endpoint["probeBaud"],
            bridge_sha256=args.bridge_sha256,
            device_risk_token=args.device_risk_token,
            firmware_risk_token=args.firmware_risk_token,
        )
        report.update(executed)
        report["firmwareImageBytesAttempted"] = executed["write"][
            "firmwareImageBytesAttempted"
        ]
        report["outcome"] = "target-stock-application-responsive-pair-unverified"
        return_code = 0
    except Exception as error:
        report["error"] = str(error)
        if isinstance(error, SblWriteFailure):
            report["write"] = error.audit
        report.update(getattr(error, "execution_result", {}))
        if isinstance(report.get("write"), dict):
            report["firmwareImageBytesAttempted"] = report["write"].get(
                "firmwareImageBytesAttempted", 0
            )
        if hasattr(error, "bridge_failure_evidence"):
            report["bridgeFailureEvidence"] = error.bridge_failure_evidence
        report["outcome"] = "stopped-postflight-or-write-unverified"
    finally:
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        report["sourcesUnchangedAtEnd"] = frozen == {
            str(path.resolve()): _sha(path.read_bytes()) for path in sources
        }
    if report["sourcesUnchangedAtEnd"] is not True:
        report["targetStockApplicationResponsive"] = False
        report["glassesRecovered"] = False
        report["outcome"] = "source-drift-invalidated-run"
        return_code = 2
    (args.output / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
