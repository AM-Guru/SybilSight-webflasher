#!/usr/bin/env python3
"""Run one schema-16 seated YHM off-reset-edge capture and restore stock Case."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import secrets
import shlex
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from case_armed_sbl_probe_flash.run_probe import locked_reset_without_queries
from case_output_off_reset_capture.artifacts import inspect as inspect_probe
from case_output_off_reset_capture.build import SOURCES as PROBE_SOURCES
from case_output_off_reset_capture.protocol import EVIDENCE_BYTES, configuration, decode
from case_output_off_reset_capture.stager import CONFIG, EVIDENCE, OutputEdgeStager, BASE, SIZE
from case_output_off_reset_capture.writer_artifacts import inspect_writer
from case_native_task_flash.build import CASE_SERIAL
from case_native_task_flash.transaction import trial
from case_native_task_hello_flash.run_probe import CaseBackend
from case_sbl_discovery.run import preflight
from g2_case_rom import restore_application
from g2_case_output_window import OUTPUT_OFF, OUTPUT_ON, output_state, send_output, status
from g2_case_yhm_output_probe import read_yhm
from g2_case_pogo_flasher import _drain_case_console, _open_case_console


ROOT = Path(__file__).resolve().parent
ADDRESSES = (0x08009800, 0x0800D800)
MIRRORS = (0x08049800, 0x0804D800)
HOST_WAIT_SECONDS = 35.0


def sha(data):
    import hashlib
    return hashlib.sha256(data).hexdigest()


def validate_staging(path, writer):
    report = json.loads(path.read_text())
    if (
        report.get("operation") != "schema16-seated-yhm-edge-changed-range-staging-qualification"
        or report.get("schemaVersion") != 16
        or report.get("caseSerial") != CASE_SERIAL
        or report.get("writerPayloadSha256") != sha(writer)
        or report.get("outcome") != "mode2-and-original-restore-verified"
        or report.get("originalSramRestoredAndVerified") is not True
        or report.get("candidatePagesUnchanged") is not True
        or report.get("stockVersionRestored") != "1.2.57"
        or report.get("flashWrites") != 0
        or report.get("templeCommandBytes") != 0
        or report.get("glassesFirmwareImageBytes") != 0
    ):
        raise ValueError("schema-16 changed-range staging not hardware-qualified")
    rows = report.get("rows", [])
    if len(rows) != 2 or {row.get("page") for row in rows} != {0, 1}:
        raise ValueError("schema-16 staging page coverage incomplete")
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
            raise ValueError("schema-16 staging evidence differs")
    sources = report.get("sourceHashes")
    if not isinstance(sources, dict) or len(sources) < 10:
        raise ValueError("schema-16 staging provenance is incomplete")
    if any(
        not Path(name).is_file() or sha(Path(name).read_bytes()) != digest
        for name, digest in sources.items()
    ):
        raise ValueError("schema-16 staging source/input changed")


class OutputEdgeCaptureBackend(CaseBackend):
    def _observe_route(self, route):
        self.check_sources()
        self.verify(0x08000000, self.hello["patched-case"], "complete schema-16 patched case")
        nonce = secrets.randbits(32) or 1
        cfg = configuration(route, nonce)
        hook = self.hello["hook"]
        self.report["captureNonce"] = nonce
        self.report["sramDirty"] = True
        self.save()
        before = self.loader.bytes_written
        self.loader.stage_probe(hook, cfg)
        self.report["probeSramBytesAttempted"] = self.loader.bytes_written - before
        self.verify(BASE, hook, "complete schema-16 hook")
        self.verify(CONFIG, cfg, "schema-16 configuration")
        self.check_sources()
        self.report["outputEdgeCaptureBootStarted"] = True
        self.save()
        output_off_attempted = False
        try:
            with _open_case_console(self.args.device) as port:
                initial = _drain_case_console(port, 3) + status(port, 3)
                if output_state(initial) != 1:
                    raise ValueError("Case output flag must begin enabled")
                output_off_attempted = True
                off_raw, off_ok = send_output(port, OUTPUT_OFF, 0)
                self.report["offCaptureSha256"] = sha(off_raw)
                if not off_ok:
                    raise ValueError("stock output-off not acknowledged")
                time.sleep(5)
                yhm_off = read_yhm(port, self.args.output / f"edge-{route}.json", "off")
                self.report["yhmOffBeforeTrigger"] = yhm_off
                if (yhm_off["outputFlagInSameCapture"] != 0
                        or yhm_off["hardwareReg3"] != 0xAE
                        or yhm_off["hardwareReg4"] != 0xAE):
                    raise ValueError("both YHM output registers must be AE before trigger")
            reset = locked_reset_without_queries(
                self.args.device, self.args.output / f"console-{route}"
            )
            self.report["stockResetCommand"] = reset
            self.save()
            print(f"OFF-RESET-EDGE {route.upper()}: receiver executing with both temples seated", flush=True)
            time.sleep(HOST_WAIT_SECONDS)
        finally:
            if output_off_attempted:
                # Read retained SRAM before another console command can reset
                # the Case. The transaction restores original Case flash/SRAM,
                # boots stock, and verifies output-on in its final postflight.
                self.report["outputCleanupPendingStockRestore"] = True
                self.save()
        raw = self.read(EVIDENCE, EVIDENCE_BYTES)
        (self.args.output / f"off-reset-edge-{route}-result.bin").write_bytes(raw)
        result = decode(raw)
        if (
            result["status"]
            or not result["probeQualified"]
            or result["nonce"] != nonce
            or result["route"] != route
            or result["templeBytesSent"] != 0
        ):
            raise ValueError(f"schema-16 off-reset-edge capture not qualified: {result}")
        self.verify(CONFIG, bytes(8), "consumed schema-16 request")
        observed = result["evenBootloaderLog"]["evenBootloaderLogObserved"]
        self.report["templeCommandBytes"] += result["templeBytesSent"]
        self.report["evenBootloaderLogObserved"] = observed
        self.report["rawPb9ElectricalActivityObserved"] = result["rawPb9Observation"]["electricalActivityObserved"]
        self.report["physicalApolloResetVerified"] = False
        self.save()
        print(
            f"OFF-RESET-EDGE {route}: pre-pulse={result['insertionWaitSystickWraps']} SysTick wraps "
            f"capture={result['passiveCaptureSystickWraps']} wraps "
            f"post-pulse={result['postPulseCaptureSystickWraps']} wraps "
            f"rx={result['totalReceiveBytes']} marker={observed} "
            f"pre-edges={result['rawPb9Observation']['prePulse']['transitions']} "
            f"post-edges={result['rawPb9Observation']['postPulse']['transitions']}",
            flush=True,
        )
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    for name in ("build", "plan", "probe-build", "case-reference", "staging-qualification", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--route", choices=("left", "right"), required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--execute-off-reset-edge-capture", action="store_true")
    mode.add_argument("--restore-only-from", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")

    _writer_manifest, writer, pages = inspect_writer(
        args.build, args.plan, args.probe_build, args.case_reference
    )
    _probe_manifest, probe = inspect_probe(args.probe_build, args.case_reference)
    validate_staging(args.staging_qualification, writer)
    paths = [
        Path(__file__), ROOT / "stager.py", ROOT / "writer_artifacts.py",
        ROOT / "protocol.py", ROOT / "artifacts.py", ROOT / "qualify_stager.py",
        *[ROOT / name for name in PROBE_SOURCES],
        ROOT.parent / "case_armed_sbl_probe_flash/run_probe.py",
        ROOT.parent / "case_native_task_flash/transaction.py",
        ROOT.parent / "case_native_task_flash/stager.py",
        ROOT.parent / "case_native_task_flash/protocol.py",
        ROOT.parent / "case_native_task_hello_flash/run_probe.py",
        ROOT.parent / "case_native_task_recovery/rom_epochs.py",
        ROOT.parent / "g2_case_rom.py",
        ROOT.parent / "g2_case_output_window.py",
        ROOT.parent / "g2_case_yhm_output_probe.py",
        ROOT.parent / "case_sbl_discovery/run.py",
        ROOT.parent / "g2_case_pogo_flasher.py",
        args.build / "writer.bin", args.build / "validated-writer.json",
        args.build / "pages.h", args.plan / "plan.json",
        args.probe_build / "hook.bin", args.probe_build / "trampoline.bin",
        args.probe_build / "patched-case.bin", args.probe_build / "validated-manifest.json",
        args.staging_qualification, args.case_reference,
    ]
    frozen = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    args.output.mkdir(parents=True)
    report = {
        "operation": "schema16-seated-yhm-off-reset-edge-uart-pb9-capture",
        "schemaVersion": 16,
        "caseSerial": CASE_SERIAL,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "writerPayloadSha256": sha(writer),
        "probePayloadSha256": sha(probe["hook"]),
        "sourceHashes": frozen,
        "pageOperations": [],
        "caseFlashMayBeChanged": False,
        "sramDirty": False,
        "templeCommandBytes": 0,
        "templeFirmwareImageBytes": 0,
        "physicalApolloResetVerified": False,
        "glassesRecovered": False,
        "outcome": "not-started",
        "romTransferEvents": [],
    }
    loader = OutputEdgeStager(
        args.device,
        events=report["romTransferEvents"],
        bad_reads=args.output / "read-diagnostics",
    )
    backend = None
    engine_started = stock_touched = False
    try:
        if args.restore_only_from:
            previous = json.loads((args.restore_only_from / "audit.json").read_text())
            original = (args.restore_only_from / "original-sram.bin").read_bytes()
            if (
                previous["caseSerial"] != CASE_SERIAL
                or previous["writerPayloadSha256"] != sha(writer)
                or previous["originalSramSha256"] != sha(original)
                or len(original) != SIZE
            ):
                raise ValueError("restore snapshot identity/size differs")
            mirrors = {
                int(row["address"], 16): (args.restore_only_from / row["file"]).read_bytes()
                for row in previous["mirrorBackups"]
            }
            if set(mirrors) != set(MIRRORS) or any(
                sha(mirrors[int(row["address"], 16)]) != row["sha256"]
                for row in previous["mirrorBackups"]
            ):
                raise ValueError("restore mirror backup differs")
        else:
            report["preflight"] = preflight(args.device, CASE_SERIAL, args.route)
            if not report["preflight"]["left_present"] or not report["preflight"]["right_present"]:
                raise ValueError("schema-16 off-reset-edge capture requires both temples seated")
            stock_touched = True
            stock = args.case_reference.read_bytes()[32:]
            loader.verify(0x08000000, stock, label="preflight original code")
            for page, address in enumerate(ADDRESSES):
                loader.verify(address, pages[page][0], label="preflight original page")
            mirrors = {address: loader.read(address, 2048) for address in MIRRORS}
            original = loader.read(BASE, SIZE)
        (args.output / "original-sram.bin").write_bytes(original)
        report["originalSramSha256"] = sha(original)
        report["mirrorBackups"] = []
        for address, data in mirrors.items():
            filename = f"mirror-{address:08x}.bin"
            (args.output / filename).write_bytes(data)
            report["mirrorBackups"].append({
                "address": hex(address), "file": filename, "sha256": sha(data)
            })
        restore_args = [sys.executable, str(Path(__file__).resolve()), "--device", args.device]
        for name in ("build", "plan", "probe_build", "case_reference", "staging_qualification"):
            restore_args.extend(["--" + name.replace("_", "-"), str(getattr(args, name).resolve())])
        restore_args.extend([
            "--route", args.route, "--restore-only-from", str(args.output.resolve()),
            "--output", str(args.output.resolve()) + "-restore",
        ])
        (args.output / "restore-command.txt").write_text(shlex.join(restore_args) + "\n")
        backend = OutputEdgeCaptureBackend(
            args, report, writer, pages, probe, original, mirrors, frozen, loader=loader
        )
        backend.save()
        engine_started = True
        result = trial(
            backend, [pair[0] for pair in pages], [pair[1] for pair in pages],
            restore_only=bool(args.restore_only_from),
        )
        report["transaction"] = result
        restored = (
            result["fullStockVerified"] and result["sramRestored"]
            and result["stockBooted"] and not result["restoreErrors"]
        )
        if restored:
            with _open_case_console(args.device) as port:
                final_raw = _drain_case_console(port, 3) + status(port, 3)
                report["stockOutputFlagAfterRestore"] = output_state(final_raw)
                (args.output / "stock-output-after-restore.bin").write_bytes(final_raw)
                report["stockYhmAfterRestoreSamples"] = []
                for sample in range(3):
                    yhm = read_yhm(port, args.output / "stock-output.json", f"after-restore-{sample}")
                    report["stockYhmAfterRestoreSamples"].append(yhm)
                    if (yhm["outputFlagInSameCapture"] == 1
                            and yhm["hardwareReg3"] == 0xAF
                            and yhm["hardwareReg4"] == 0xAF):
                        break
                    time.sleep(1)
                report["stockYhmAfterRestore"] = report["stockYhmAfterRestoreSamples"][-1]
            report["stockOutputAfterRestoreVerified"] = (
                report["stockOutputFlagAfterRestore"] == 1
                and report["stockYhmAfterRestore"]["outputFlagInSameCapture"] == 1
                and report["stockYhmAfterRestore"]["hardwareReg3"] == 0xAF
                and report["stockYhmAfterRestore"]["hardwareReg4"] == 0xAF
            )
            if not report["stockOutputAfterRestoreVerified"]:
                restored = False
        if args.restore_only_from and restored:
            report["outcome"] = "restore-only-verified"
        elif result["context"] and restored and not result["error"]:
            report["outcome"] = (
                "off-reset-edge-capture-complete-stock-restored-activity"
                if report.get("rawPb9ElectricalActivityObserved")
                else "off-reset-edge-capture-complete-stock-restored-static"
            )
        elif restored:
            report["outcome"] = "stock-restored-off-reset-edge-capture-not-qualified"
        else:
            report["outcome"] = "restore-unverified-hold-rom"
    except Exception as error:
        report["error"] = str(error)
        report["outcome"] = "preflight-failed-no-flash-operation"
        if stock_touched and not engine_started:
            try:
                report["stockVersionRestored"] = restore_application(
                    args.device, expected_version="1.2.57"
                )
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
    print(json.dumps({
        key: value for key, value in report.items()
        if key not in ("preflight", "sourceHashes", "romTransferEvents")
    }, indent=2), flush=True)
    return 0 if report["outcome"] in (
        "off-reset-edge-capture-complete-stock-restored-activity",
        "off-reset-edge-capture-complete-stock-restored-static",
        "restore-only-verified",
    ) else 2


if __name__ == "__main__":
    raise SystemExit(main())
