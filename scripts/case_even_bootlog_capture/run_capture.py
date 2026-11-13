#!/usr/bin/env python3
"""Run one schema-14 insertion-window passive capture and restore stock Case state."""

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
from case_even_bootlog_capture.artifacts import inspect as inspect_probe
from case_even_bootlog_capture.build import SOURCES as PROBE_SOURCES
from case_even_bootlog_capture.protocol import EVIDENCE_BYTES, configuration, decode
from case_even_bootlog_capture.stager import CONFIG, EVIDENCE, PassiveBootlogStager, BASE, SIZE
from case_even_bootlog_capture.writer_artifacts import inspect_writer
from case_native_task_flash.build import CASE_SERIAL
from case_native_task_flash.transaction import trial
from case_native_task_hello_flash.run_probe import CaseBackend
from case_sbl_discovery.run import preflight
from g2_case_rom import restore_application


ROOT = Path(__file__).resolve().parent
ADDRESSES = (0x08009800, 0x0800D800)
MIRRORS = (0x08049800, 0x0804D800)
ARM_CUE_DELAY_SECONDS = 5.0
HOST_WAIT_SECONDS = 75.0


def sha(data):
    import hashlib
    return hashlib.sha256(data).hexdigest()


def validate_staging(path, writer):
    report = json.loads(path.read_text())
    if (
        report.get("operation") != "schema14-passive-bootlog-changed-range-staging-qualification"
        or report.get("schemaVersion") != 14
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
        raise ValueError("schema-14 changed-range staging not hardware-qualified")
    rows = report.get("rows", [])
    if len(rows) != 2 or {row.get("page") for row in rows} != {0, 1}:
        raise ValueError("schema-14 staging page coverage incomplete")
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
            raise ValueError("schema-14 staging evidence differs")
    sources = report.get("sourceHashes")
    if not isinstance(sources, dict) or len(sources) < 10:
        raise ValueError("schema-14 staging provenance is incomplete")
    if any(
        not Path(name).is_file() or sha(Path(name).read_bytes()) != digest
        for name, digest in sources.items()
    ):
        raise ValueError("schema-14 staging source/input changed")


class PassiveCaptureBackend(CaseBackend):
    def _observe_route(self, route):
        self.check_sources()
        self.verify(0x08000000, self.hello["patched-case"], "complete schema-14 patched case")
        nonce = secrets.randbits(32) or 1
        cfg = configuration(route, nonce)
        hook = self.hello["hook"]
        self.report["captureNonce"] = nonce
        self.report["sramDirty"] = True
        self.save()
        before = self.loader.bytes_written
        self.loader.stage_probe(hook, cfg)
        self.report["probeSramBytesAttempted"] = self.loader.bytes_written - before
        self.verify(BASE, hook, "complete schema-14 hook")
        self.verify(CONFIG, cfg, "schema-14 configuration")
        self.check_sources()
        self.report["passiveCaptureBootStarted"] = True
        self.save()
        reset = locked_reset_without_queries(
            self.args.device, self.args.output / f"console-{route}"
        )
        self.report["stockResetCommand"] = reset
        self.save()
        time.sleep(ARM_CUE_DELAY_SECONDS)
        print(
            f"ARMED PASSIVE {route.upper()}: insert the entire selected pair NOW; "
            "RX has had a 5-second startup margin and remains active through "
            "the 12,000-wrap pulse boundary plus 3,000 wraps.",
            flush=True,
        )
        time.sleep(HOST_WAIT_SECONDS)
        raw = self.read(EVIDENCE, EVIDENCE_BYTES)
        (self.args.output / f"passive-bootlog-{route}-result.bin").write_bytes(raw)
        result = decode(raw)
        if (
            result["status"]
            or not result["probeQualified"]
            or result["nonce"] != nonce
            or result["route"] != route
            or result["templeBytesSent"] != 0
        ):
            raise ValueError(f"schema-14 passive capture not qualified: {result}")
        self.verify(CONFIG, bytes(8), "consumed schema-14 request")
        observed = result["evenBootloaderLog"]["evenBootloaderLogObserved"]
        self.report["templeCommandBytes"] += result["templeBytesSent"]
        self.report["evenBootloaderLogObserved"] = observed
        self.report["physicalApolloResetVerified"] = False
        self.save()
        print(
            f"PASSIVE {route}: wait={result['insertionWaitSystickWraps']} SysTick wraps "
            f"capture={result['passiveCaptureSystickWraps']} wraps "
            f"post-pulse={result['postPulseCaptureSystickWraps']} wraps "
            f"rx={result['totalReceiveBytes']} marker={observed}",
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
    mode.add_argument("--execute-passive-capture", action="store_true")
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
        "operation": "schema14-armed-insertion-passive-bootlog-capture",
        "schemaVersion": 14,
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
    loader = PassiveBootlogStager(
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
            report["preflight"] = preflight(
                args.device, CASE_SERIAL, args.route, await_insertion=True
            )
            if report["preflight"]["left_present"] or report["preflight"]["right_present"]:
                raise ValueError("schema-14 passive capture requires an empty Case before arming")
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
        backend = PassiveCaptureBackend(
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
        if args.restore_only_from and restored:
            report["outcome"] = "restore-only-verified"
        elif result["context"] and restored and not result["error"]:
            report["outcome"] = (
                "passive-capture-complete-stock-restored-marker-observed"
                if report.get("evenBootloaderLogObserved")
                else "passive-capture-complete-stock-restored-no-marker"
            )
        elif restored:
            report["outcome"] = "stock-restored-passive-capture-not-qualified"
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
        "passive-capture-complete-stock-restored-marker-observed",
        "passive-capture-complete-stock-restored-no-marker",
        "restore-only-verified",
    ) else 2


if __name__ == "__main__":
    raise SystemExit(main())
