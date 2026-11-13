#!/usr/bin/env python3
"""Run a pinned seated Case capture and automatically resume stock restoration.

The capture runner owns page writes and exact verification. This supervisor
never writes flash itself. If the runner exits with an unverified restore, it
invokes that same runner's restore-only mode using the saved original pages,
mirrors, and full SRAM snapshot. It never repeats the capture or temple TX.
"""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time


CASE_SERIAL = "002300405845501620373941"
ALLOWED_RUNNERS = {
    "case_output_off_reset_sbl_hello/run_capture.py": "--execute-off-reset-sbl-hello-capture",
    "case_output_off_reset_sbl_hello_115200/run_capture.py": "--execute-off-reset-sbl-hello-115200-capture",
}
ARTIFACT_FLAGS = (
    "build", "plan", "probe_build", "case_reference", "staging_qualification"
)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def stock_verified(report):
    transaction = report.get("transaction") or {}
    return (
        report.get("caseSerial") == CASE_SERIAL
        and transaction.get("fullStockVerified") is True
        and transaction.get("sramRestored") is True
        and transaction.get("stockBooted") is True
        and not transaction.get("restoreErrors")
        and report.get("fullOriginalCodeAndMirrorsVerified") is True
        and report.get("originalSramRestoredAndVerified") is True
        and report.get("stockVersionRestored") == "1.2.57"
        and report.get("stockOutputAfterRestoreVerified") is True
        and report.get("stockOutputFlagAfterRestore") == 1
        and (report.get("stockYhmAfterRestore") or {}).get("hardwareReg3") == 0xAF
        and (report.get("stockYhmAfterRestore") or {}).get("hardwareReg4") == 0xAF
    )


def load_capture(directory):
    report = json.loads((directory / "audit.json").read_text())
    if report.get("caseSerial") != CASE_SERIAL:
        raise ValueError("Case serial differs from the pinned original")
    backup = directory / "original-sram.bin"
    if (not backup.is_file() or len(backup.read_bytes()) != 0x8000
            or sha(backup) != report.get("originalSramSha256")):
        raise ValueError("full original SRAM backup missing or changed")
    mirrors = report.get("mirrorBackups") or []
    if len(mirrors) != 2 or {row.get("address") for row in mirrors} != {"0x8049800", "0x804d800"}:
        raise ValueError("both mirror backups required")
    for row in mirrors:
        path = directory / row["file"]
        if not path.is_file() or path.stat().st_size != 2048 or sha(path) != row.get("sha256"):
            raise ValueError("mirror backup missing or changed")
    return report


def command(args, output, *, restore_only_from=None):
    relative = args.runner.resolve().relative_to(Path(__file__).resolve().parent)
    if str(relative) not in ALLOWED_RUNNERS:
        raise ValueError("runner is not in the fixed Case capture allowlist")
    result = [sys.executable, str(args.runner.resolve()), "--device", args.device]
    for name in ARTIFACT_FLAGS:
        result.extend(["--" + name.replace("_", "-"), str(getattr(args, name).resolve())])
    result.extend(["--output", str(output.resolve()), "--route", args.route])
    if restore_only_from:
        result.extend(["--restore-only-from", str(restore_only_from.resolve())])
    else:
        result.append(ALLOWED_RUNNERS[str(relative)])
    return result


def supervise(args, *, invoke=subprocess.run):
    capture = args.output.resolve()
    events = []
    if args.launch:
        if capture.exists():
            raise ValueError("capture output must be fresh")
        cmd = command(args, capture)
        if args.dry_run:
            return {"operation": "guarded-case-capture", "dryRun": True,
                    "launchCommand": cmd, "restoreOutputPrefix": str(capture) + "-restore-auto-"}
        completed = invoke(cmd, check=False)
        events.append({"kind": "capture", "exitCode": completed.returncode})
    elif args.dry_run:
        report = load_capture(capture)
        return {"operation": "guarded-case-capture", "dryRun": True,
                "captureStockVerified": stock_verified(report),
                "restoreCommand": None if stock_verified(report) else command(
                    args, Path(str(capture) + "-restore-auto-1"), restore_only_from=capture)}

    report = load_capture(capture)
    if stock_verified(report):
        outcome = "capture-stock-verified"
        final = capture / "audit.json"
    else:
        if report.get("caseFlashMayBeChanged") is not True and report.get("sramDirty") is not True:
            raise ValueError("capture failed before a restorable mutation; inspect its audit")
        final = None
        for attempt in (1, 2):
            destination = Path(str(capture) + f"-restore-auto-{attempt}")
            if destination.exists():
                raise ValueError("automatic restore output already exists")
            completed = invoke(command(args, destination, restore_only_from=capture), check=False)
            path = destination / "audit.json"
            restored = json.loads(path.read_text()) if path.is_file() else {}
            verified = stock_verified(restored) and restored.get("outcome") == "restore-only-verified"
            events.append({"kind": "restore-only", "attempt": attempt,
                           "exitCode": completed.returncode, "stockVerified": verified,
                           "audit": str(path) if path.is_file() else None})
            if completed.returncode == 0 and verified:
                final = path
                break
            time.sleep(1)
        outcome = "restore-only-verified" if final else "restore-unverified-hold-rom"

    result = {"operation": "guarded-case-capture", "caseSerial": CASE_SERIAL,
              "captureAudit": str(capture / "audit.json"),
              "captureAuditSha256": sha(capture / "audit.json"),
              "events": events, "outcome": outcome,
              "finalStockVerified": final is not None,
              "finalAudit": str(final) if final else None,
              "finalAuditSha256": sha(final) if final else None,
              "templeFirmwareImageBytesSent": 0}
    (capture / "guarded-restore-audit.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runner", required=True, type=Path)
    parser.add_argument("--device", required=True)
    for name in ARTIFACT_FLAGS:
        parser.add_argument("--" + name.replace("_", "-"), required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--route", required=True, choices=("left", "right"))
    parser.add_argument("--launch", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = supervise(args)
    print(json.dumps(result, indent=2))
    return 0 if result.get("dryRun") or result["finalStockVerified"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
