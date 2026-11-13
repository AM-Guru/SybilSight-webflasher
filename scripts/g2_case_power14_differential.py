#!/usr/bin/env python3
"""Compare stock Case PMIC-current samples with output on, off, then on.

This does not measure pogo voltage or prove a temple/Apollo reset. The only
state-changing packets are the stock Case output-off/on commands; on is sent
again during cleanup if any off attempt began.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from case_native_task_flash.build import CASE_SERIAL
from case_sbl_discovery.run import preflight
from g2_case_output_window import OUTPUT_OFF, OUTPUT_ON, output_state, send_output, status
from g2_case_pogo_flasher import _open_case_console, _drain_case_console
from g2_pogo_protocol import parse_response

POWER14 = bytes.fromhex("5aa57f041400020098")
FRAME_PREFIX = bytes.fromhex("5aa5ff0b14010307")
FRAME_BYTES = 16


def decode_power14(raw: bytes) -> dict[str, object]:
    frames = []
    for off in range(max(0, len(raw) - FRAME_BYTES + 1)):
        if raw[off:off + len(FRAME_PREFIX)] != FRAME_PREFIX:
            continue
        frame = raw[off:off + FRAME_BYTES]
        parsed = parse_response(frame)
        if not parsed.checksum_valid or len(parsed.payload) != 11:
            continue
        body = parsed.payload
        if body[5] not in (0, 1):
            continue
        magnitude = int.from_bytes(body[6:8], "little")
        frames.append({
            "frameHex": frame.hex(),
            "currentRaw": -magnitude if body[5] else magnitude,
            "temperatureRaw": body[8],
            "counterRaw": int.from_bytes(body[9:11], "little"),
            "statusRaw": body[4],
        })
    if len(frames) != 1:
        raise ValueError(f"expected one CRC-valid stock power frame, got {len(frames)}")
    return frames[0]


def sample(port, count: int) -> tuple[list[dict[str, object]], bytes]:
    values = []
    captured = bytearray()
    for _ in range(count):
        if port.write(POWER14) != len(POWER14):
            raise IOError("truncated Case power request")
        port.flush()
        raw = _drain_case_console(port, 0.45)
        captured.extend(raw)
        values.append(decode_power14(raw))
    return values, bytes(captured)


def run(device: str, output: Path, count: int) -> dict[str, object]:
    if output.exists():
        raise ValueError("audit path must be fresh")
    if not 4 <= count <= 16:
        raise ValueError("sample count outside 4..16")
    output.parent.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {
        "operation": "stock-case-power14-output-on-off-on-differential",
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "caseSerial": CASE_SERIAL,
        "requestHex": POWER14.hex(),
        "offRequestHex": OUTPUT_OFF.hex(),
        "onRequestHex": OUTPUT_ON.hex(),
        "samplesPerPhase": count,
        "templeCommandBytesSent": 0,
        "caseFlashBytesWritten": 0,
        "sramPayloadUploaded": False,
        "pogoVoltageMeasured": False,
        "apolloResetVerified": False,
        "outcome": "not-started",
    }
    port = None
    off_attempted = False
    try:
        before = preflight(device, CASE_SERIAL, "left")
        report["preflight"] = {k: before[k] for k in (
            "caseSerial", "case_version", "left_present", "right_present", "ota_glasses"
        )}
        port = _open_case_console(device)
        initial = _drain_case_console(port, 2.5) + status(port, 2.5)
        if output_state(initial) != 1:
            raise ValueError("Case output flag must start enabled")
        values, raw = sample(port, count)
        output.with_name(output.stem + "-before.bin").write_bytes(raw)
        report["before"] = values
        report["beforeSha256"] = hashlib.sha256(raw).hexdigest()
        off_attempted = True
        off_raw, off_ok = send_output(port, OUTPUT_OFF, 0)
        report["offAcknowledged"] = off_ok
        report["offCommandSha256"] = hashlib.sha256(off_raw).hexdigest()
        if not off_ok:
            raise ValueError("Case output off not confirmed")
        time.sleep(1.0)
        values, raw = sample(port, count)
        output.with_name(output.stem + "-off.bin").write_bytes(raw)
        report["off"] = values
        report["offSha256"] = hashlib.sha256(raw).hexdigest()
        on_raw, on_ok = send_output(port, OUTPUT_ON, 1)
        report["onAcknowledged"] = on_ok
        report["onCommandSha256"] = hashlib.sha256(on_raw).hexdigest()
        if not on_ok:
            raise ValueError("Case output on not confirmed")
        time.sleep(1.0)
        values, raw = sample(port, count)
        output.with_name(output.stem + "-after.bin").write_bytes(raw)
        report["after"] = values
        report["afterSha256"] = hashlib.sha256(raw).hexdigest()
        report["medianCurrentRaw"] = {
            label: statistics.median(x["currentRaw"] for x in report[label])
            for label in ("before", "off", "after")
        }
        report["outcome"] = "completed"
    except (Exception, KeyboardInterrupt) as error:
        report["error"] = f"{type(error).__name__}: {error}"
        report["outcome"] = "failed-closed"
    finally:
        if off_attempted:
            try:
                if port is None or not port.is_open:
                    port = _open_case_console(device)
                _raw, ok = send_output(port, OUTPUT_ON, 1)
                report["cleanupOutputOnConfirmed"] = ok
                if not ok:
                    report["outcome"] = "output-restore-unverified"
            except Exception as error:
                report["cleanupError"] = f"{type(error).__name__}: {error}"
                report["outcome"] = "output-restore-unverified"
        if port is not None:
            port.close()
        report["usbPortClosed"] = port is None or not port.is_open
        try:
            after = preflight(device, CASE_SERIAL, "left")
            report["postflight"] = {k: after[k] for k in (
                "caseSerial", "case_version", "left_present", "right_present", "ota_glasses"
            )}
        except Exception as error:
            report["postflightError"] = f"{type(error).__name__}: {error}"
            report["outcome"] = "postflight-unverified"
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        output.write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--samples", type=int, default=8)
    parser.add_argument("--execute-stock-output-window", action="store_true", required=True)
    args = parser.parse_args()
    report = run(args.device, args.output, args.samples)
    print(json.dumps({k: report.get(k) for k in (
        "outcome", "medianCurrentRaw", "cleanupOutputOnConfirmed",
        "usbPortClosed", "error", "postflightError"
    )}, indent=2))
    return 0 if report["outcome"] == "completed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
