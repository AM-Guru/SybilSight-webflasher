#!/usr/bin/env python3
"""Run one locked insertion-window armed-SBL probe and restore stock case state."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from case_armed_sbl_probe.artifacts import inspect_build as inspect_probe
from case_armed_sbl_probe.build import SOURCES as PROBE_SOURCES
from case_armed_sbl_probe.protocol import configuration, decode as decode_probe
from case_armed_sbl_probe_flash.artifacts import inspect as inspect_writer
from case_armed_sbl_probe_flash.build import sha, source_paths
from case_armed_sbl_probe_flash.stager import ArmedSblStager, BASE, SIZE
from case_native_task_flash.build import CASE_SERIAL
from case_native_task_flash.transaction import trial
from case_native_task_hello_flash.run_probe import CaseBackend
from case_sbl_discovery.run import preflight
from g2_case_pogo_flasher import _drain_case_console, _open_case_console, FINAL_RESET_COMMAND, FINAL_RESET_CONFIRMATION
from g2_case_rom import restore_application
from g2_even_bootlog import classify_even_bootloader_log

ADDRESSES = (0x08009800, 0x0800D800)
MIRRORS = (0x08049800, 0x0804D800)
# Hardware-derived bound: the empty-Case 115200 run was still at attempt 10/20
# after the former 27-second host wait. Keep the Case application alive long
# enough for the 15-second insertion wait plus all 20 bounded receive windows.
HOST_WAIT_SECONDS = 45.0


def validate_staging(path, writer):
    report = json.loads(path.read_text())
    if (
        report.get("operation") != "schema12-armed-sbl-changed-range-staging-qualification"
        or report.get("caseSerial") != CASE_SERIAL
        or report.get("writerPayloadSha256") != sha(writer)
        or report.get("outcome") != "mode2-and-original-restore-verified"
        or report.get("originalSramRestoredAndVerified") is not True
        or report.get("candidatePagesUnchanged") is not True
        or report.get("stockVersionRestored") != "1.2.57"
        or report.get("flashWrites") != 0
        or report.get("customTempleQueryBytes") != 0
        or report.get("glassesFirmwareImageBytes") != 0
    ):
        raise ValueError("schema-12 staging qualification differs")
    rows = report.get("rows", [])
    if len(rows) != 2 or {row.get("page") for row in rows} != {0, 1}:
        raise ValueError("schema-12 mode-2 page coverage incomplete")
    for row in rows:
        result = row.get("result", {})
        if (
            result.get("status")
            or result.get("mode") != 2
            or result.get("page") != row.get("page")
            or result.get("eraseStarts")
            or result.get("programDoublewords")
            or result.get("busyAtEnd")
        ):
            raise ValueError("schema-12 mode-2 evidence differs")
    if any(sha(Path(name).read_bytes()) != digest for name, digest in report.get("sourceHashes", {}).items()):
        raise ValueError("schema-12 qualification source/input changed")


def locked_reset_without_queries(device, output):
    output.mkdir(parents=True)
    capture = bytearray()
    result = {
        "operation": "single-deb0-without-temple-query",
        "templeQueryBytes": 0,
        "resetSent": False,
        "resetConfirmed": False,
    }
    try:
        with _open_case_console(device) as port:
            capture.extend(_drain_case_console(port, 0.25))
            port.reset_input_buffer()
            if port.write(FINAL_RESET_COMMAND) != len(FINAL_RESET_COMMAND):
                raise ValueError("truncated DEB0 command")
            port.flush()
            result["resetSent"] = True
            deadline = time.monotonic() + 2.0
            while time.monotonic() < deadline:
                capture.extend(port.read(4096))
                if FINAL_RESET_CONFIRMATION.search(capture):
                    break
            if not FINAL_RESET_CONFIRMATION.search(capture):
                raise ValueError("DEB0 confirmation missing; command not replayed")
            result["resetConfirmed"] = True
            result["caseBusyLockExpected"] = True
            result["outcome"] = "armed-insertion-window-started"
    finally:
        (output / "console.bin").write_bytes(capture)
        (output / "audit.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


class ArmedBackend(CaseBackend):
    def _observe_route(self, route):
        self.check_sources()
        self.verify(0x08000000, self.hello["patched-case"], "complete schema-12 patched case")
        nonce = secrets.randbits(32) or 1
        cfg = configuration(route, self.args.baud, nonce)
        hook = self.hello["hook"]
        self.report["probeNonce"] = nonce
        self.report["sramDirty"] = True
        self.save()
        before = self.loader.bytes_written
        self.loader.stage_probe(hook, cfg)
        self.report["probeSramBytesAttempted"] = self.loader.bytes_written - before
        self.verify(BASE, hook, "complete schema-12 hook")
        self.verify(0x20011F00, cfg, "schema-12 configuration")
        self.check_sources()
        self.report["probeBootStarted"] = True
        self.save()
        reset = locked_reset_without_queries(self.args.device, self.args.output / f"console-{route}")
        self.report["stockResetCommand"] = reset
        self.save()
        print(
            f"ARMED {route.upper()}: insert the complete secondary pair NOW; "
            f"the case busy-lock window closes in about 15 seconds (probe baud {self.args.baud}).",
            flush=True,
        )
        time.sleep(HOST_WAIT_SECONDS)
        raw = self.read(0x20011A00, 512)
        (self.args.output / f"armed-sbl-{route}-result.bin").write_bytes(raw)
        result = decode_probe(raw)
        result["evenBootloaderLog"] = classify_even_bootloader_log(
            bytes.fromhex(result["rawCaptureHex"])
        )
        if result["status"] or not result["probeQualified"] or result["nonce"] != nonce or result["route"] != route:
            raise ValueError(f"armed SBL probe not qualified: {result}")
        self.verify(0x20011F00, bytes(8), "consumed schema-12 request")
        self.report["customTempleQueryBytes"] += result["templeBytesSent"]
        self.report["validSblStatusFrames"] += len(result["discovery"]["statusFrames"])
        self.report["sblEndpointVerified"] = bool(result["discovery"]["statusFrames"])
        self.report["evenBootloaderLogObserved"] = (
            self.args.baud == 1_000_000
            and result["evenBootloaderLog"]["evenBootloaderLogObserved"]
        )
        self.save()
        print(
            f"ARMED {route}: wait={result['insertionWaitHalTicks']} ticks, "
            f"attempts={result['helloAttempts']}, status={len(result['discovery']['statusFrames'])}",
            flush=True,
        )
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    for name in ("build", "plan", "probe-build", "case-reference", "staging-qualification", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--route", choices=("left", "right"), required=True)
    parser.add_argument("--baud", type=int, choices=(115_200, 1_000_000), required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--execute-armed-probe", action="store_true")
    mode.add_argument("--restore-only-from", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")

    _writer_manifest, writer, pages = inspect_writer(args.build, args.plan, args.probe_build, args.case_reference)
    _probe_manifest, probe = inspect_probe(args.probe_build, args.case_reference)
    validate_staging(args.staging_qualification, writer)
    probe_root = Path(__file__).resolve().parents[1] / "case_armed_sbl_probe"
    paths = [
        Path(__file__),
        Path(__file__).resolve().parent / "stager.py",
        Path(__file__).resolve().parent / "artifacts.py",
        *source_paths(),
        *[probe_root / name for name in PROBE_SOURCES],
        Path(__file__).resolve().parents[1] / "case_native_task_flash/transaction.py",
        Path(__file__).resolve().parents[1] / "case_native_task_hello_flash/run_probe.py",
        Path(__file__).resolve().parents[1] / "case_native_task_recovery/rom_epochs.py",
        Path(__file__).resolve().parents[1] / "g2_case_rom.py",
        Path(__file__).resolve().parents[1] / "g2_even_bootlog.py",
        Path(__file__).resolve().parents[1] / "case_sbl_discovery/run.py",
        Path(__file__).resolve().parents[1] / "g2_case_pogo_flasher.py",
        args.build / "writer.bin",
        args.build / "validated-writer.json",
        args.build / "pages.h",
        args.plan / "plan.json",
        args.probe_build / "hook.bin",
        args.probe_build / "trampoline.bin",
        args.probe_build / "patched-case.bin",
        args.probe_build / "validated-manifest.json",
        args.staging_qualification,
        args.case_reference,
    ]
    frozen = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    args.output.mkdir(parents=True)
    (args.output / "source-snapshot").mkdir()
    for index, name in enumerate(frozen):
        (args.output / "source-snapshot" / f"{index:02}-{Path(name).name}").write_bytes(Path(name).read_bytes())
    report = {
        "operation": "schema12-armed-insertion-sbl-probe",
        "schemaVersion": 12,
        "caseSerial": CASE_SERIAL,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "writerPayloadSha256": sha(writer),
        "probePayloadSha256": sha(probe["hook"]),
        "sourceHashes": frozen,
        "pageOperations": [],
        "caseFlashMayBeChanged": False,
        "sramDirty": False,
        "customTempleQueryBytes": 0,
        "templeFirmwareImageBytes": 0,
        "validSblStatusFrames": 0,
        "probeBaud": args.baud,
        "physicalApolloResetVerified": False,
        "glassesRecovered": False,
        "outcome": "not-started",
        "romTransferEvents": [],
    }
    loader = ArmedSblStager(args.device, events=report["romTransferEvents"], bad_reads=args.output / "read-diagnostics")
    backend = None
    engine_started = stock_touched = False
    try:
        if args.restore_only_from:
            previous = json.loads((args.restore_only_from / "audit.json").read_text())
            original = (args.restore_only_from / "original-sram.bin").read_bytes()
            if previous["caseSerial"] != CASE_SERIAL or previous["writerPayloadSha256"] != sha(writer) or previous["originalSramSha256"] != sha(original) or len(original) != SIZE:
                raise ValueError("restore snapshot identity/size differs")
            mirrors = {int(row["address"], 16): (args.restore_only_from / row["file"]).read_bytes() for row in previous["mirrorBackups"]}
        else:
            report["preflight"] = preflight(args.device, CASE_SERIAL, args.route, await_insertion=True)
            stock_touched = True
            stock = args.case_reference.read_bytes()[32:]
            loader.verify(0x08000000, stock, label="preflight original code")
            for page, address in enumerate(ADDRESSES):
                loader.verify(address, pages[page][0], label="preflight original page")
            mirrors = {address: loader.read(address, 2048) for address in MIRRORS}
            original = loader.read(BASE, SIZE)
        if set(mirrors) != set(MIRRORS):
            raise ValueError("restore mirror set differs")
        (args.output / "original-sram.bin").write_bytes(original)
        report["originalSramSha256"] = sha(original)
        report["mirrorBackups"] = []
        for address, data in mirrors.items():
            filename = f"mirror-{address:08x}.bin"
            (args.output / filename).write_bytes(data)
            report["mirrorBackups"].append({"address": hex(address), "file": filename, "sha256": sha(data)})
        restore_args = [sys.executable, str(Path(__file__).resolve()), "--device", args.device]
        for name in ("build", "plan", "probe_build", "case_reference", "staging_qualification"):
            restore_args.extend(["--" + name.replace("_", "-"), str(getattr(args, name).resolve())])
        restore_args.extend(["--route", args.route, "--restore-only-from", str(args.output.resolve()), "--output", str(args.output.resolve()) + "-restore"])
        (args.output / "restore-command.txt").write_text(shlex.join(restore_args) + "\n")
        backend = ArmedBackend(args, report, writer, pages, probe, original, mirrors, frozen, loader=loader)
        backend.save()
        engine_started = True
        result = trial(backend, [pair[0] for pair in pages], [pair[1] for pair in pages], restore_only=bool(args.restore_only_from))
        report["transaction"] = result
        restored = result["fullStockVerified"] and result["sramRestored"] and result["stockBooted"] and not result["restoreErrors"]
        if args.restore_only_from and restored:
            report["outcome"] = "restore-only-verified"
        elif result["context"] and restored and not result["error"]:
            report["outcome"] = "armed-sbl-status-observed-stock-restored" if report["validSblStatusFrames"] else "armed-probe-complete-stock-restored-no-status"
        elif restored:
            report["outcome"] = "stock-restored-probe-not-qualified"
        else:
            report["outcome"] = "restore-unverified-hold-rom"
    except Exception as error:
        report["error"] = str(error)
        report["outcome"] = "preflight-failed-no-flash-operation"
        if stock_touched and not engine_started:
            try:
                report["stockVersionRestored"] = restore_application(args.device, expected_version="1.2.57")
            except Exception as cleanup:
                report["stockRestoreError"] = str(cleanup)
    finally:
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        report["sramBytesAttempted"] = loader.bytes_written
        report["unchangedSramEpochsSkipped"] = loader.epochs_skipped
        if backend:
            backend.save()
        else:
            (args.output / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k not in ("preflight", "sourceHashes", "romTransferEvents")}, indent=2), flush=True)
    return 0 if report["outcome"] in ("armed-sbl-status-observed-stock-restored", "armed-probe-complete-stock-restored-no-status", "restore-only-verified") else 2


if __name__ == "__main__":
    raise SystemExit(main())
