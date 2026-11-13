#!/usr/bin/env python3
"""Test a seated Case reset while its stock output is disabled.

The Case accepts one fixed DEB0 reset between fixed stock 0x3F output-off/on
requests. The output-on request is always attempted in cleanup. No temple
firmware image or Case firmware image is written by this experiment.
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
from g2_case_output_window import OUTPUT_OFF, OUTPUT_ON, output_state, send_output, status
from g2_case_yhm_output_probe import read_yhm
from g2_case_pogo_flasher import (
    FINAL_RESET_COMMAND, FINAL_RESET_CONFIRMATION,
    _drain_case_console, _open_case_console,
)
from g2_seated_reset_control import query_route


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def live_state(result: dict[str, object]) -> dict[str, object]:
    return {key: result[key] for key in (
        "caseSerial", "case_version", "left_present", "right_present", "ota_glasses"
    )}


def run(device: str, output: Path) -> dict[str, object]:
    if output.exists():
        raise ValueError("audit path must be fresh")
    output.parent.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {
        "operation": "stock-case-output-off-deb0-on-seated-original",
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "caseSerial": CASE_SERIAL,
        "offRequestHex": OUTPUT_OFF.hex(),
        "resetRequestAscii": "DEB0",
        "onRequestHex": OUTPUT_ON.hex(),
        "resetRequestsSent": 0,
        "templeFirmwareImageBytesSent": 0,
        "caseFirmwareImageBytesWritten": 0,
        "physicalApolloResetVerified": False,
        "outcome": "not-started",
    }
    port = None
    off_attempted = False
    try:
        before = live_state(preflight(device, CASE_SERIAL, "left"))
        report["preflight"] = before
        if not before["left_present"] or not before["right_present"] or before["ota_glasses"] != 0:
            raise ValueError("both temples must be seated with Case OTA inactive")
        port = _open_case_console(device)
        initial = _drain_case_console(port, 3) + status(port, 3)
        if output_state(initial) != 1:
            raise ValueError("Case output flag must start enabled")
        report["before"] = read_yhm(port, output, "before")
        off_attempted = True
        off_raw, off_ok = send_output(port, OUTPUT_OFF, 0)
        output.with_name(f"{output.stem}-off.bin").write_bytes(off_raw)
        report["offAcknowledgedAndFlagDisabled"] = off_ok
        report["offCaptureSha256"] = sha(off_raw)
        if not off_ok:
            raise ValueError("output-off was not acknowledged and observed")
        time.sleep(5)
        report["off"] = read_yhm(port, output, "off")
        if (report["off"]["outputFlagInSameCapture"] != 0
                or report["off"]["hardwareReg3"] != 0xAE
                or report["off"]["hardwareReg4"] != 0xAE):
            raise ValueError("live YHM output-off state did not qualify")
        port.reset_input_buffer()
        report["resetRequestsSent"] = 1
        if port.write(FINAL_RESET_COMMAND) != len(FINAL_RESET_COMMAND):
            raise IOError("truncated DEB0 reset request")
        port.flush()
        reset_raw = _drain_case_console(port, 3)
        output.with_name(f"{output.stem}-reset.bin").write_bytes(reset_raw)
        report["resetCaptureSha256"] = sha(reset_raw)
        report["resetConfirmed"] = bool(FINAL_RESET_CONFIRMATION.search(reset_raw))
        if not report["resetConfirmed"]:
            raise ValueError("one DEB0 request sent but Case reset confirmation absent")
        # Let the stock reset task finish before its output is restored.
        time.sleep(9)
        report["afterResetBeforeOutputOn"] = read_yhm(port, output, "reset-off")
        report["outcome"] = "reset-confirmed-under-output-off"
    except (Exception, KeyboardInterrupt) as error:
        report["error"] = f"{type(error).__name__}: {error}"
        report["outcome"] = "failed-closed"
    finally:
        if off_attempted:
            try:
                if port is None or not port.is_open:
                    port = _open_case_console(device)
                on_raw, on_ok = send_output(port, OUTPUT_ON, 1)
                output.with_name(f"{output.stem}-on.bin").write_bytes(on_raw)
                report["onAcknowledgedAndFlagEnabled"] = on_ok
                report["onCaptureSha256"] = sha(on_raw)
                if not on_ok:
                    report["outcome"] = "output-restore-unverified"
                else:
                    time.sleep(5)
                    report["after"] = read_yhm(port, output, "after")
                    if (report["after"]["outputFlagInSameCapture"] != 1
                            or report["after"]["hardwareReg3"] != 0xAF
                            or report["after"]["hardwareReg4"] != 0xAF):
                        report["outcome"] = "output-restore-unverified"
            except Exception as error:
                report["onError"] = f"{type(error).__name__}: {error}"
                report["outcome"] = "output-restore-unverified"
        if port is not None:
            port.close()
        report["usbPortClosed"] = port is None or not port.is_open
        try:
            report["postflight"] = live_state(preflight(device, CASE_SERIAL, "left"))
        except Exception as error:
            report["postflightError"] = f"{type(error).__name__}: {error}"
            report["outcome"] = "postflight-unverified"
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        output.write_text(json.dumps(report, indent=2) + "\n")
    if report["outcome"] == "reset-confirmed-under-output-off":
        report["routes"] = [query_route(device, route) for route in ("left", "right")]
        report["outcome"] = (
            "both-application-replies" if all(route["versionReply"] is not None for route in report["routes"])
            else "one-or-more-application-replies-missing"
        )
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        output.write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--execute-seated-output-reset", required=True, action="store_true")
    args = parser.parse_args()
    report = run(args.device, args.output)
    print(json.dumps(report, indent=2))
    return 0 if report["outcome"] == "both-application-replies" else 2


if __name__ == "__main__":
    raise SystemExit(main())
