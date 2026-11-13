#!/usr/bin/env python3
"""Record Jumperless's two audio ADC channels around one stock Case DEB0.

Requires an independently qualified, fresh physical wiring receipt. This
script does not configure the Jumperless crossbar or enable its audio mode.
It never sends the reset until the exact two-channel audio stream is live.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import threading
import time

import numpy as np
import sounddevice as sd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from case_native_task_flash.build import CASE_SERIAL
from case_sbl_discovery.run import preflight
from g2_case_pogo_flasher import (
    FINAL_RESET_COMMAND,
    FINAL_RESET_CONFIRMATION,
    _drain_case_console,
    _open_case_console,
    parse_case_restore_evidence,
)

SAMPLE_RATE = 16_000
AUDIO_NAME = "JL Audio In"
CHANNELS = 2
MAX_QUALIFIER_AGE_SECONDS = 900
EXPECTED_PAD_ROWS = {
    "left": {"positive": 2, "negative": 1},
    "right": {"positive": 3, "negative": 4},
}


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_qualification(data: dict, route: str, now: datetime) -> dict:
    if route not in EXPECTED_PAD_ROWS or data.get("status") != "qualified":
        raise ValueError("current route lacks qualified wiring")
    if data.get("caseSerial") != CASE_SERIAL or data.get("route") != route:
        raise ValueError("qualification is bound to a different Case or route")
    recorded = datetime.fromisoformat(data["qualifiedAt"])
    if recorded.tzinfo is None or not 0 <= (now - recorded).total_seconds() <= MAX_QUALIFIER_AGE_SECONDS:
        raise ValueError("qualification is missing, stale, or future-dated")
    for key in ("caseContactPolarityVerified", "noExternalDriveVerified",
                "crossbarNetsVerified", "bothContactsPresent"):
        if data.get(key) is not True:
            raise ValueError(f"qualification missing {key}")
    pad = EXPECTED_PAD_ROWS[route]
    if data.get("positivePadRow") != pad["positive"] or data.get("negativePadRow") != pad["negative"]:
        raise ValueError("pad polarity or row mapping does not match measured plan")
    channels = data.get("audioChannels")
    if channels != {"positive": 0, "negative": 1}:
        raise ValueError("audio channels must be simultaneous positive and negative pad taps")
    if data.get("audioAdcRows") != {"ADC0": pad["positive"], "ADC1": pad["negative"]}:
        raise ValueError("audio ADC routing must terminate at this temple's pad rows")
    if data.get("audioFullScaleVolts") != 8.0 or data.get("audioDcBlock") is not False:
        raise ValueError("audio acquisition must use 8 V full scale without DC blocking")
    if data.get("audioSampleRate") != SAMPLE_RATE:
        raise ValueError("audio acquisition sample rate differs from the host recorder")
    # The separate meter must agree at the actual breadboard ends. This
    # receipt records operator measurements; the host cannot inspect probes.
    direct = data.get("directPadVolts")
    row = data.get("breadboardEndVolts")
    spread = data.get("breadboardSpreadVolts")
    if not all(isinstance(x, (int, float)) and not isinstance(x, bool)
               for x in (direct, row, spread)):
        raise ValueError("DC meter comparison missing")
    if not 0.5 <= direct <= 5.0 or abs(row - direct) > 0.2 or not 0 <= spread <= 0.1:
        raise ValueError("glasses lead continuity is not qualified")
    return data


def find_exact_audio_device(audio_module=sd) -> int:
    found = [
        i for i, device in enumerate(audio_module.query_devices())
        if device["name"] == AUDIO_NAME and device["max_input_channels"] >= CHANNELS
    ]
    if len(found) != 1:
        raise ValueError(f"expected exactly one {AUDIO_NAME} two-channel input, found {len(found)}")
    audio_module.check_input_settings(
        device=found[0], channels=CHANNELS, samplerate=SAMPLE_RATE, dtype="float32"
    )
    return found[0]


def fresh_same_session_case_check(port) -> dict:
    raw = bytearray(_drain_case_console(port, 2.5))
    query = b"DEA3\n"
    if port.write(query) != len(query):
        raise IOError("Case status query truncated")
    port.flush()
    raw.extend(_drain_case_console(port, 1.2))
    status = parse_case_restore_evidence(bytes(raw), require_reset_confirmation=False)
    if not status["left_present"] or not status["right_present"] or status["ota_glasses"]:
        raise ValueError("same-session Case status does not show both contacts and idle OTA")
    return {k: status[k] for k in ("left_present", "right_present", "ota_glasses")}


def record_one(device: str, output: Path, route: str, qualifier: Path, *,
               audio_module=sd) -> dict:
    if output.exists():
        raise ValueError("output directory must be fresh")
    data = json.loads(qualifier.read_text())
    validate_qualification(data, route, datetime.now(timezone.utc))
    audio_index = find_exact_audio_device(audio_module)
    output.mkdir(parents=True)
    report: dict[str, object] = {
        "operation": "one-stock-case-reset-with-jumperless-two-channel-audio",
        "startedAt": utc(),
        "caseSerial": CASE_SERIAL,
        "route": route,
        "sampleRate": SAMPLE_RATE,
        "audioDeviceName": AUDIO_NAME,
        "audioDeviceIndex": audio_index,
        "qualifierSha256": hashlib.sha256(qualifier.read_bytes()).hexdigest(),
        "resetCommandsAttempted": 0,
        "templeFirmwareImageBytesSent": 0,
        "caseFlashBytesWritten": 0,
        "physicalApolloResetVerified": False,
        "outcome": "not-started",
    }
    port = None
    stream = None
    blocks: list[np.ndarray] = []
    block_clock: list[tuple[int, int]] = []
    first_block = threading.Event()
    audio_errors: list[str] = []
    sample_count = 0

    def callback(indata, frames, time_info, status):
        nonlocal sample_count
        if status:
            audio_errors.append(str(status))
        blocks.append(indata.copy())
        block_clock.append((sample_count, time.monotonic_ns()))
        sample_count += frames
        first_block.set()

    try:
        report["preflight"] = {
            k: v for k, v in preflight(device, CASE_SERIAL, route).items()
            if k in ("caseSerial", "case_version", "left_present", "right_present", "ota_glasses")
        }
        port = _open_case_console(device)
        report["sameSessionCaseCheck"] = fresh_same_session_case_check(port)
        stream = audio_module.InputStream(
            device=audio_index, channels=CHANNELS, samplerate=SAMPLE_RATE,
            dtype="float32", blocksize=512, callback=callback,
        )
        stream.start()
        if not first_block.wait(timeout=5.0) or not stream.active:
            raise RuntimeError("Jumperless audio stream produced no live input blocks")
        report["firstAudioBlockMonotonicNs"] = block_clock[0][1]
        report["audioLiveBeforeReset"] = True
        time.sleep(2.0)
        if not stream.active or sample_count < SAMPLE_RATE:
            raise RuntimeError("audio baseline did not complete before reset")
        report["resetAttemptMonotonicNs"] = time.monotonic_ns()
        report["resetCommandsAttempted"] = 1
        if port.write(FINAL_RESET_COMMAND) != len(FINAL_RESET_COMMAND):
            raise IOError("stock Case DEB0 write truncated")
        port.flush()
        reset_raw = _drain_case_console(port, 2.2)
        (output / "case-reset.bin").write_bytes(reset_raw)
        report["resetConsoleSha256"] = hashlib.sha256(reset_raw).hexdigest()
        report["caseResetConfirmed"] = bool(FINAL_RESET_CONFIRMATION.search(reset_raw))
        time.sleep(5.0)
        if audio_errors or not stream.active:
            report["outcome"] = "audio-stream-fault-after-reset"
        else:
            report["outcome"] = (
                "captured-case-reset-confirmed"
                if report["caseResetConfirmed"] else "captured-case-reset-unconfirmed"
            )
    except (Exception, KeyboardInterrupt) as error:
        report["error"] = f"{type(error).__name__}: {error}"
        report["outcome"] = "failed-closed"
    finally:
        if stream is not None:
            try:
                stream.stop()
                stream.close()
            except Exception as error:
                report["audioCloseError"] = f"{type(error).__name__}: {error}"
                report["outcome"] = "audio-close-unverified"
        if port is not None:
            port.close()
        report["casePortClosed"] = port is None or not port.is_open
        report["audioErrors"] = audio_errors
        report["audioBlockClock"] = block_clock
        if blocks:
            samples = np.concatenate(blocks, axis=0)
            np.save(output / "audio-raw-f32.npy", samples, allow_pickle=False)
            difference = samples[:, 0] - samples[:, 1]
            np.save(output / "pad-difference-f32.npy", difference, allow_pickle=False)
            report["audioFrames"] = int(samples.shape[0])
            report["audioRawSha256"] = hashlib.sha256(
                (output / "audio-raw-f32.npy").read_bytes()
            ).hexdigest()
            report["padDifferenceSha256"] = hashlib.sha256(
                (output / "pad-difference-f32.npy").read_bytes()
            ).hexdigest()
            report["amplitudeBoundary"] = (
                "Float audio samples are uncalibrated; DC and pad volts require "
                "separate meter qualification. Block timestamps include unknown USB audio latency."
            )
        try:
            after = preflight(device, CASE_SERIAL, route)
            report["postflight"] = {k: after[k] for k in (
                "caseSerial", "case_version", "left_present", "right_present", "ota_glasses"
            )}
        except Exception as error:
            report["postflightError"] = f"{type(error).__name__}: {error}"
            report["outcome"] = "postflight-unverified"
        report["finishedAt"] = utc()
        (output / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", default="/dev/cu.usbserial-210")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--route", required=True, choices=("left", "right"))
    parser.add_argument("--qualification", required=True, type=Path)
    parser.add_argument("--execute-one-reset", action="store_true", required=True)
    args = parser.parse_args()
    report = record_one(args.device, args.output, args.route, args.qualification)
    print(json.dumps({k: report.get(k) for k in (
        "outcome", "audioFrames", "audioLiveBeforeReset",
        "resetCommandsAttempted", "caseResetConfirmed", "casePortClosed", "error"
    )}, indent=2))
    return 0 if report["outcome"] == "captured-case-reset-confirmed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
