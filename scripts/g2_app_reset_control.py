#!/usr/bin/env python3
"""Send only the stock G2 product-test 0x0B application reset via the Case.

The stock app acknowledges 0x0B, then invokes its system reset routine. A
Case transport timeout cannot prove the command was received or a reset ran.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))

from case_native_task_flash.build import CASE_SERIAL
from case_sbl_discovery.run import preflight
from g2_seated_reset_control import setup_failure_restoration
import g2_case_pogo_flasher as pogo
from g2_pogo_protocol import add_ordinary_checksum, parse_response


RESET_REQUEST = add_ordinary_checksum(bytes.fromhex("0b000000"))
RESET_REPLY_BODY = bytes.fromhex("0b01030100")
BRIDGE_SHA256 = "71da2a7283ce6200d5c38935b1dd619ac27a1884d87b1e520e621c5046e0bb02"
BRIDGE_CHANGES = {
    0x388: (0x24, 0x0B),  # 0x24 read-version becomes 0x0B only
    0x38C: (0x52, 0xF0),  # disable OTA START
    0x390: (0x53, 0xF1),  # disable OTA HEADER
    0x394: (0x54, 0xF2),  # disable OTA DATA
    0x398: (0x55, 0xF3),  # disable OTA FINISH
    0x492: (0x24, 0x0B),  # cached-reply classification
}


def build_reset_only_bridge() -> bytes:
    base = pogo.build_bridge(observed_charging_phase=True)
    candidate = bytearray(base)
    for offset, (before, after) in BRIDGE_CHANGES.items():
        if candidate[offset:offset + 2] != bytes((before, 0x2E)):
            raise ValueError(f"reviewed bridge instruction differs at {offset:#x}")
        candidate[offset] = after
    result = bytes(candidate)
    if hashlib.sha256(result).hexdigest() != BRIDGE_SHA256:
        raise ValueError("reset-only bridge hash differs")
    if len(result) != len(base) or sum(a != b for a, b in zip(base, result)) != len(BRIDGE_CHANGES):
        raise ValueError("reset-only bridge changed bytes outside the six fixed immediates")
    return result


class ResetOnlyTransport(pogo.CaseSramTempleTransport):
    def _start(self) -> None:
        self.payload = build_reset_only_bridge()
        self._permitted_writes = {
            (pogo.PROOF_ADDRESS, pogo.ZERO_PROOF),
            (pogo.RESULT_ADDRESS, bytes(pogo.RESULT_LENGTH)),
        }
        for offset in range(0, len(self.payload), 256):
            self._permitted_writes.add(
                (pogo.SRAM_ADDRESS + offset, self.payload[offset:offset + 256])
            )
        super()._start()

    def transact(self, request: bytes, timeout: float) -> bytes:
        if request != RESET_REQUEST:
            raise pogo.SafetyError("reset-only transport accepts exactly one fixed 0x0B request")
        return super().transact(request, timeout)


def reset_route(device: str, route: str) -> dict[str, object]:
    result: dict[str, object] = {
        "route": route, "requestHex": RESET_REQUEST.hex(),
        "templeRequestAttempts": 0, "acknowledged": False, "attempts": [],
    }
    for number in range(1, 5):
        transport = None
        attempt: dict[str, object] = {"number": number}
        setup_retry = False
        try:
            transport = ResetOnlyTransport(
                device, route, observed_charging_phase=True
            )
            result["templeRequestAttempts"] = 1
            reply = transport.transact(RESET_REQUEST, 8.0)
            attempt["responseHex"] = reply.hex()
            parsed = parse_response(reply)
            if not parsed.checksum_valid or parsed.payload != RESET_REPLY_BODY:
                raise ValueError("0x0B response is not the exact success acknowledgement")
            result["acknowledged"] = True
        except Exception as error:
            attempt["error"] = f"{type(error).__name__}: {error}"
            if transport is None:
                attempt["caseRouteRestored"], evidence = setup_failure_restoration(error)
                if evidence is not None:
                    attempt["setupFailureEvidence"] = evidence
            setup_retry = (
                transport is None
                and "bridge setup status 3:" in str(error)
                and result["templeRequestAttempts"] == 0
            )
        finally:
            if transport is not None:
                try:
                    pogo._close_checked(transport)
                    attempt["caseRouteRestored"] = True
                except Exception as error:
                    attempt["caseRouteRestored"] = False
                    attempt["restoreError"] = f"{type(error).__name__}: {error}"
            elif "caseRouteRestored" not in attempt:
                attempt["caseRouteRestored"] = None
            result["attempts"].append(attempt)
        if not setup_retry or number == 4:
            break
        time.sleep(0.5 * number)
    result["caseRouteRestored"] = all(
        row["caseRouteRestored"] is True for row in result["attempts"]
    )
    return result


def run(device: str, output: Path) -> dict[str, object]:
    if output.exists():
        raise ValueError("output audit path must be fresh")
    output.parent.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).read_bytes()
    report: dict[str, object] = {
        "operation": "g2-seated-fixed-product-test-0b-app-reset",
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "sourceSha256": hashlib.sha256(source).hexdigest(),
        "caseSerial": CASE_SERIAL,
        "resetOnlyBridgeSha256": BRIDGE_SHA256,
        "templeFirmwareImageBytesSent": 0,
        "caseFlashBytesWritten": 0,
        "physicalApolloResetVerified": False,
        "outcome": "not-started",
    }
    try:
        build_reset_only_bridge()
        proof = preflight(device, CASE_SERIAL, "left")
        report["preflight"] = {
            k: proof[k] for k in (
                "caseSerial", "case_version", "left_present", "right_present", "ota_glasses"
            )
        }
        report["routes"] = [reset_route(device, route) for route in ("left", "right")]
        post = preflight(device, CASE_SERIAL, "left")
        report["postflight"] = {
            k: post[k] for k in (
                "caseSerial", "case_version", "left_present", "right_present", "ota_glasses"
            )
        }
        report["outcome"] = (
            "one-or-more-application-reset-acks"
            if any(row["acknowledged"] for row in report["routes"])
            else "no-application-reset-ack"
        )
        if any(row["caseRouteRestored"] is False for row in report["routes"]):
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
    mode.add_argument("--inspect-bridge", action="store_true")
    mode.add_argument("--execute-seated-reset", action="store_true")
    args = parser.parse_args()
    if args.inspect_bridge:
        bridge = build_reset_only_bridge()
        print(json.dumps({"bytes": len(bridge), "sha256": BRIDGE_SHA256, "requestHex": RESET_REQUEST.hex()}))
        return 0
    report = run(args.device, args.output)
    print(json.dumps(report, indent=2))
    return 0 if report["outcome"] == "one-or-more-application-reset-acks" else 2


if __name__ == "__main__":
    raise SystemExit(main())
