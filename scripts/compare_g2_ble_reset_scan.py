#!/usr/bin/env python3
"""Bind a timed Case reset to a saved, overlapping Bluetooth scan."""

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path


CASE_SERIAL = "002300405845501620373941"
STOCK_G2_MANUFACTURER_PREFIX = "455253323131"  # ERS211 in prior stock scans


def load(path):
    raw = path.read_bytes()
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def compare(scan_path, timing_path, reset_path):
    scan_doc, scan_sha = load(scan_path)
    scan = scan_doc.get("result", scan_doc)
    timing, timing_sha = load(timing_path)
    reset, reset_sha = load(reset_path)
    scan_start, scan_end = map(instant, (scan["startedAt"], scan["completedAt"]))
    reset_start, reset_end = map(instant, (
        timing["resetCallStartedAt"], timing["resetCallFinishedAt"]
    ))
    if not scan_start < reset_start < reset_end < scan_end:
        raise ValueError("scan did not bracket the Case reset call")
    if (
        scan.get("centralState") != "poweredOn"
        or scan.get("errors") != []
        or timing.get("audit") != str(reset_path.resolve())
        or timing.get("auditOutcome") != reset.get("outcome")
        or reset.get("caseSerial") != CASE_SERIAL
        or reset.get("resetCommandsSent") != 1
        or reset.get("caseReset", {}).get("reset_confirmed") is not True
        or reset.get("caseStockPostflightVerified") is not True
        or reset.get("preflight", {}).get("left_present") is not True
        or reset.get("preflight", {}).get("right_present") is not True
        or reset.get("postflight", {}).get("left_present") is not True
        or reset.get("postflight", {}).get("right_present") is not True
        or reset.get("postflight", {}).get("case_version") != "1.2.57"
        or reset.get("postflight", {}).get("ota_glasses") != 0
        or reset.get("templeFirmwareImageBytesSent") != 0
        or reset.get("caseFlashBytesWritten") != 0
        or not all(row.get("caseRouteRestored") is True for row in reset.get("routes", []))
    ):
        raise ValueError("reset, target presence or stock Case cleanup did not qualify")
    devices = scan.get("devices", [])
    named_g2 = [d for d in devices if "g2" in d.get("name", "").lower()]
    signature_g2 = [d for d in devices if d.get("manufacturerDataHex", "").lower().startswith(
        STOCK_G2_MANUFACTURER_PREFIX
    )]
    return {
        "operation": "timed-case-reset-overlapping-bluetooth-scan-comparison",
        "caseSerial": CASE_SERIAL,
        "sources": {
            "scan": {"path": str(scan_path.resolve()), "sha256": scan_sha},
            "timing": {"path": str(timing_path.resolve()), "sha256": timing_sha},
            "reset": {"path": str(reset_path.resolve()), "sha256": reset_sha},
        },
        "scanStartedAt": scan["startedAt"],
        "scanCompletedAt": scan["completedAt"],
        "resetCallStartedAt": timing["resetCallStartedAt"],
        "resetCallFinishedAt": timing["resetCallFinishedAt"],
        "resetCallFullyWithinScan": True,
        "scanSecondsBeforeResetCall": (reset_start - scan_start).total_seconds(),
        "scanSecondsAfterResetCall": (scan_end - reset_end).total_seconds(),
        "advertisementRecords": len(devices),
        "namedG2Advertisements": [d.get("identifier") for d in named_g2],
        "stockG2ManufacturerSignatureAdvertisements": [d.get("identifier") for d in signature_g2],
        "unnamedConnectableAdvertisements": sum(
            d.get("connectable") is True and d.get("name") in (None, "", "(unnamed)")
            for d in devices
        ),
        "applicationVersionReplies": sum(row.get("versionReply") is not None for row in reset["routes"]),
        "caseStockRestored": True,
        "physicalApolloResetVerified": False,
        "glassesRecovered": False,
        "proofBoundary": (
            "No named or prior-stock-signature G2 advertisement in this scan window "
            "is time-bounded negative evidence. Anonymous advertisements cannot be "
            "assigned to the pair, and a Case reset acknowledgement does not prove "
            "Apollo reset or bootloader entry."
        ),
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("scan", "timing", "reset", "output"):
        p.add_argument("--" + name, required=True, type=Path)
    args = p.parse_args()
    if args.output.exists():
        p.error("output must be fresh")
    result = compare(args.scan, args.timing, args.reset)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: result[k] for k in (
        "resetCallFullyWithinScan", "namedG2Advertisements",
        "stockG2ManufacturerSignatureAdvertisements", "applicationVersionReplies",
        "caseStockRestored",
    )}))


if __name__ == "__main__":
    main()
