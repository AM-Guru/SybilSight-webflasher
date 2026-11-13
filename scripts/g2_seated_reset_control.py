#!/usr/bin/env python3
"""One software-controlled bilateral Case reset and read-only temple check.

Keep both temples seated. This confirms the Case's DEB0 handler and checks
application liveness; it cannot by itself prove an Apollo hardware reset.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))

from case_native_task_flash.build import CASE_SERIAL, sha
from case_sbl_discovery.run import preflight
from g2_case_pogo_flasher import (
    CaseSramTempleTransport,
    MainFirmwareFlasher,
    _close_checked,
    reset_both_temples_and_recheck,
)


def setup_failure_restoration(error: Exception) -> tuple[bool | None, dict[str, object] | None]:
    """Use the bridge's strict retained cleanup proof when construction fails."""
    evidence = getattr(error, "bridge_failure_evidence", None)
    if not isinstance(evidence, dict):
        return None, None
    retained = evidence.get("retained_result")
    if not isinstance(retained, dict):
        return None, evidence
    no_route_write = retained.get("zero_write_setup_stop_verified") is True
    exact_route_restore = (
        retained.get("baseline_mask") == "0x3ff"
        and retained.get("restored_mask") == "0x3ff"
        and evidence.get("baseline_hex") == evidence.get("restored_hex")
    )
    verified = (
        (no_route_write or exact_route_restore)
        and evidence.get("case_application_version") == "1.2.57"
        and evidence.get("cleanup_errors") == []
    )
    return bool(verified), evidence


def query_route(device: str, route: str) -> dict[str, object]:
    result: dict[str, object] = {"route": route, "versionReply": None, "attempts": []}
    for attempt_number in range(1, 5):
        transport = None
        attempt: dict[str, object] = {"number": attempt_number}
        retry_phase = False
        try:
            transport = CaseSramTempleTransport(
                device, route, observed_charging_phase=True
            )
            result["versionReply"] = asdict(MainFirmwareFlasher(transport).read_version())
        except Exception as error:
            attempt["queryError"] = f"{type(error).__name__}: {error}"
            if transport is None:
                attempt["caseRouteRestored"], evidence = setup_failure_restoration(error)
                if evidence is not None:
                    attempt["setupFailureEvidence"] = evidence
            retry_phase = "bridge setup status 3:" in str(error)
        finally:
            if transport is not None:
                try:
                    _close_checked(transport)
                    attempt["caseRouteRestored"] = True
                except Exception as error:
                    attempt["caseRouteRestored"] = False
                    attempt["restoreError"] = f"{type(error).__name__}: {error}"
            elif "caseRouteRestored" not in attempt:
                attempt["caseRouteRestored"] = None
            result["attempts"].append(attempt)
        if result["versionReply"] is not None or not retry_phase or attempt_number == 4:
            break
        time.sleep(0.5 * attempt_number)
    if result["versionReply"] is None:
        result["queryError"] = result["attempts"][-1].get("queryError")
    result["caseRouteRestored"] = all(
        attempt["caseRouteRestored"] is True for attempt in result["attempts"]
    )
    return result


def run(device: str, output: Path, *, send_reset: bool = True) -> dict[str, object]:
    if output.exists():
        raise ValueError("output audit path must be fresh")
    output.parent.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {
        "operation": (
            "g2-seated-software-reset-and-readonly-liveness"
            if send_reset else "g2-seated-readonly-liveness"
        ),
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "sourceSha256": sha(Path(__file__).read_bytes()),
        "caseSerial": CASE_SERIAL,
        "resetCommandsSent": 0,
        "templeFirmwareImageBytesSent": 0,
        "caseFlashBytesWritten": 0,
        "physicalApolloResetVerified": False,
        "outcome": "not-started",
    }
    try:
        report["preflight"] = preflight(device, CASE_SERIAL, "left")
        report["preflight"].pop("reset_command", None)
        report["preflight"].pop("reset_confirmed", None)
        if send_reset:
            # Exactly one DEB0. Do not replay if its acknowledgement is lost.
            report["resetCommandsSent"] = 1
            report["caseReset"] = reset_both_temples_and_recheck(device)
        report["routes"] = [query_route(device, route) for route in ("left", "right")]
        postflight = preflight(device, CASE_SERIAL, "left")
        report["postflight"] = {
            key: postflight[key]
            for key in ("caseSerial", "case_version", "left_present", "right_present", "ota_glasses")
        }
        report["caseStockPostflightVerified"] = True
        report["outcome"] = (
            "both-application-replies"
            if all(r["versionReply"] is not None for r in report["routes"])
            else "one-or-more-application-replies-missing"
        )
        if any(r.get("caseRouteRestored") is False for r in report["routes"]):
            report["outcome"] = "case-route-restore-unverified"
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
        report["outcome"] = "failed-closed"
    finally:
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        output.write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    parser.add_argument("--output", required=True, type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--execute-seated-reset", action="store_true")
    mode.add_argument("--read-only-recheck", action="store_true")
    args = parser.parse_args()
    report = run(args.device, args.output, send_reset=args.execute_seated_reset)
    print(json.dumps(report, indent=2))
    return 0 if report["outcome"] == "both-application-replies" else 2


if __name__ == "__main__":
    raise SystemExit(main())
