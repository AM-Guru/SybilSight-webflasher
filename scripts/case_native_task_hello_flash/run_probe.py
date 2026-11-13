#!/usr/bin/env python3
"""Bounded bilateral native-task HELLO trial with exact stock restoration."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import shlex
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from case_native_task_flash.build import CASE_SERIAL
from case_native_task_flash.console_reset import checked_console
from case_native_task_flash.protocol import decode as decode_writer, request
from case_native_task_flash.transaction import trial
from case_native_task_hello.artifacts import inspect_build as inspect_hello
from case_native_task_hello.build import SOURCES as HELLO_SOURCES
from case_native_task_hello.protocol import configuration, decode as decode_hello
from case_native_task_hello_flash.artifacts import inspect as inspect_writer
from case_native_task_hello_flash.build import sha, source_paths
from case_native_task_hello_flash.stager import BASE, SIZE, HelloStager
from case_sbl_discovery.run import preflight
from g2_case_rom import BootloaderError, go_sram, restore_application

ROOT = Path(__file__).resolve().parent
ADDRESSES = (0x08009800, 0x0800D800)
MIRRORS = (0x08049800, 0x0804D800)
HELLO_WAIT_SECONDS = 11.0


def validate_staging(path, writer):
    report = json.loads(path.read_text())
    if (
        report.get("operation")
        != "schema11-hello-changed-range-staging-qualification"
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
        raise ValueError("schema-11 changed-range staging not hardware-qualified")
    rows = report.get("rows", [])
    if len(rows) != 2 or {row.get("page") for row in rows} != {0, 1}:
        raise ValueError("staging mode-2 page coverage incomplete")
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
            raise ValueError("staging mode-2 evidence differs")
    if any(
        sha(Path(name).read_bytes()) != digest
        for name, digest in report.get("sourceHashes", {}).items()
    ):
        raise ValueError("staging qualification source/input changed")


class CaseBackend:
    def __init__(
        self,
        args,
        report,
        writer,
        pages,
        hello,
        original,
        mirrors,
        frozen,
        loader=None,
    ):
        self.args = args
        self.report = report
        self.writer = writer
        self.pages = pages
        self.hello = hello
        self.original = original
        self.mirrors = mirrors
        self.frozen = frozen
        self.stock = args.case_reference.read_bytes()[32:]
        self.loader = loader or HelloStager(
            args.device,
            events=report.setdefault("romTransferEvents", []),
            bad_reads=args.output / "read-diagnostics",
        )

    def save(self):
        path = self.args.output / "audit.json"
        temporary = path.with_suffix(".json.tmp")
        with temporary.open("w") as handle:
            json.dump(self.report, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)

    def check_sources(self):
        if any(
            sha(Path(name).read_bytes()) != digest
            for name, digest in self.frozen.items()
        ):
            raise ValueError("trial source/input changed before mutation or case boot")

    def record_error(self, error):
        self.report["trialError"] = str(error)
        self.save()

    def read(self, address, size):
        return self.loader.read(address, size)

    def verify(self, address, expected, label):
        self.loader.verify(address, expected, label=label)

    def read_page(self, page):
        if page not in (0, 1):
            raise ValueError("unscoped page")
        return self.read(ADDRESSES[page], 2048)

    def write_page(self, page, mode):
        if page not in (0, 1) or mode not in (0, 1):
            raise ValueError("unscoped page operation")
        if mode == 0:
            self.check_sources()
        nonce = secrets.randbits(32) or 1
        cfg = request(page, mode, nonce)
        operation = {
            "page": page,
            "mode": mode,
            "nonce": nonce,
            "stage": "staging-sram",
            "goCalls": 0,
        }
        self.report["pageOperations"].append(operation)
        self.report["sramDirty"] = True
        self.save()
        print(f"PAGE {page} mode{mode}: staging exact changed SRAM ranges", flush=True)
        before = self.loader.bytes_written
        self.loader.stage_writer(self.writer, cfg)
        operation["sramBytesAttempted"] = self.loader.bytes_written - before
        self.verify(BASE, self.writer, "complete SRAM writer")
        if mode == 0:
            self.check_sources()
        with self.loader.connect(verify_address=0x20013F00, expected=cfg) as port:
            operation["stage"] = "launch-uncertain"
            operation["goCalls"] = 1
            self.report["caseFlashMayBeChanged"] = True
            self.save()
            try:
                go_sram(port)
                operation["goAcknowledged"] = True
            except (BootloaderError, OSError) as error:
                operation["goAcknowledged"] = False
                operation["goAckError"] = str(error)
            finally:
                port.dtr = True
                time.sleep(2)
        raw = self.read(0x20013A00, 256)
        (self.args.output / f"operation-{len(self.report['pageOperations']):02}.bin").write_bytes(
            raw
        )
        result = decode_writer(raw)
        operation["result"] = result
        operation["stage"] = "result-collected"
        self.save()
        if (
            result["status"]
            or result["mode"] != mode
            or result["page"] != page
            or result["nonce"] != nonce
            or result["address"] != hex(ADDRESSES[page])
            or result["busyAtEnd"]
        ):
            raise ValueError(f"page writer did not complete successfully: {result}")
        self.verify(
            ADDRESSES[page],
            self.pages[page][1 if mode == 0 else 0],
            "exact hardware page",
        )
        self.verify(0x20013F00, bytes(8), "consumed writer request")
        for address, original in self.mirrors.items():
            self.verify(address, original, "opposite-bank mirror")
        operation["stage"] = "exact-page-and-mirrors-verified"
        self.save()
        print(
            f"PAGE {page} mode{mode}: exact readback verified; "
            f"erase={result['eraseStarts']} program64={result['programDoublewords']}",
            flush=True,
        )

    def observe_context(self):
        routes = ("left", "right") if self.args.route == "both" else (self.args.route,)
        results = {}
        for route in routes:
            self.report["activeHelloRoute"] = route
            self.save()
            results[route] = self._observe_route(route)
            self.report.setdefault("nativeHello", {})[route] = results[route]
            self.save()
        return results if self.args.route == "both" else results[self.args.route]

    def _observe_route(self, route):
        self.check_sources()
        self.verify(
            0x08000000, self.hello["patched-case"], "complete patched case code"
        )
        nonce = secrets.randbits(32) or 1
        cfg = configuration(route, 1000000, nonce)
        hook = self.hello["hook"]
        self.report["helloNonce"] = nonce
        self.report["sramDirty"] = True
        self.save()
        before = self.loader.bytes_written
        self.loader.stage_hello(hook, cfg)
        self.report.setdefault("helloSramBytesAttempted", {})[route] = (
            self.loader.bytes_written - before
        )
        self.verify(BASE, hook, "complete HELLO hook")
        self.verify(0x20011F00, cfg, "HELLO configuration")
        self.check_sources()
        self.report.setdefault("helloBootStarted", {})[route] = True
        self.save()
        print(
            f"HELLO {route}: one stock DEB0 reset, then bounded retained capture",
            flush=True,
        )
        reset = checked_console(
            self.args.device,
            self.args.output / f"console-{route}",
            send_reset=True,
        )
        self.report.setdefault("stockResetCommands", {})[route] = reset
        (self.args.output / f"native-hello-{route}-reset.json").write_text(
            json.dumps(reset, indent=2) + "\n"
        )
        if (
            not reset["reset_confirmed"]
            or reset["case_version"] != "1.2.57"
            or not reset["left_present"]
            or not reset["right_present"]
        ):
            raise ValueError("fresh bilateral reset/presence proof missing")
        time.sleep(HELLO_WAIT_SECONDS)
        raw = self.read(0x20011A00, 512)
        (self.args.output / f"native-hello-{route}-result.bin").write_bytes(raw)
        result = decode_hello(raw)
        if (
            result["status"]
            or not result["probeQualified"]
            or result["nonce"] != nonce
            or result["route"] != route
        ):
            raise ValueError(f"native HELLO probe not qualified: {result}")
        self.verify(0x20011F00, bytes(8), "consumed HELLO request")
        self.report["customTempleQueryBytes"] += result["templeBytesSent"]
        self.report["validSblStatusFrames"] += len(
            result["discovery"]["statusFrames"]
        )
        self.save()
        print(
            f"HELLO {route}: attempts={result['helloAttempts']} "
            f"tx={result['templeBytesSent']} rx={result['totalReceiveBytes']} "
            f"valid_status={len(result['discovery']['statusFrames'])}",
            flush=True,
        )
        return result

    def verify_stock(self):
        self.verify(0x08000000, self.stock, "complete original case code")
        for address, data in self.mirrors.items():
            self.verify(address, data, "restored mirror")
        self.report["caseFlashMayBeChanged"] = False
        self.report["fullOriginalCodeAndMirrorsVerified"] = True
        self.save()

    def restore_sram(self):
        print("RESTORE: original 32KiB SRAM snapshot", flush=True)
        self.loader.restore(self.original)
        self.report["sramDirty"] = False
        self.report["originalSramRestoredAndVerified"] = True
        self.save()

    def boot_stock(self):
        self.report["stockVersionRestored"] = restore_application(
            self.args.device, expected_version="1.2.57"
        )
        self.save()

    def hold_rom(self):
        with self.loader.connect():
            pass
        self.report["heldInRom"] = True
        self.save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    for name in (
        "build",
        "plan",
        "hello-build",
        "case-reference",
        "staging-qualification",
        "output",
    ):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--route", choices=("left", "right", "both"), default="both")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--execute-hello-trial", action="store_true")
    mode.add_argument("--restore-only-from", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")

    _writer_manifest, writer, pages = inspect_writer(
        args.build, args.plan, args.hello_build, args.case_reference
    )
    _hello_manifest, hello = inspect_hello(args.hello_build, args.case_reference)
    validate_staging(args.staging_qualification, writer)

    hello_source_root = ROOT.parent / "case_native_task_hello"
    paths = [
        Path(__file__),
        ROOT / "stager.py",
        ROOT / "artifacts.py",
        ROOT / "build.py",
        ROOT / "qualify_stager.py",
        ROOT.parent / "case_native_task_flash/transaction.py",
        ROOT.parent / "case_native_task_flash/stager.py",
        ROOT.parent / "case_native_task_flash/protocol.py",
        ROOT.parent / "case_native_task_flash/console_reset.py",
        *source_paths(),
        *[hello_source_root / name for name in HELLO_SOURCES],
        ROOT.parent / "case_native_task_recovery/rom_epochs.py",
        ROOT.parent / "g2_case_rom.py",
        ROOT.parent / "case_sbl_discovery/run.py",
        ROOT.parent / "g2_case_pogo_flasher.py",
        args.build / "writer.bin",
        args.build / "validated-writer.json",
        args.build / "pages.h",
        args.plan / "plan.json",
        args.case_reference,
        args.hello_build / "hook.bin",
        args.hello_build / "trampoline.bin",
        args.hello_build / "patched-case.bin",
        args.hello_build / "validated-manifest.json",
        args.staging_qualification,
    ]
    frozen = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    args.output.mkdir(parents=True)
    (args.output / "source-snapshot").mkdir()
    for index, name in enumerate(frozen):
        (args.output / "source-snapshot" / f"{index:02}-{Path(name).name}").write_bytes(
            Path(name).read_bytes()
        )
    report = {
        "operation": "native-case-task-schema11-hello-trial",
        "schemaVersion": 11,
        "caseSerial": CASE_SERIAL,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "writerPayloadSha256": sha(writer),
        "helloPayloadSha256": sha(hello["hook"]),
        "sourceHashes": frozen,
        "pageOperations": [],
        "caseFlashMayBeChanged": False,
        "sramDirty": False,
        "customTempleQueryBytes": 0,
        "templeFirmwareImageBytes": 0,
        "validSblStatusFrames": 0,
        "physicalApolloResetVerified": False,
        "glassesRecovered": False,
        "outcome": "not-started",
        "romTransferEvents": [],
    }
    loader = HelloStager(
        args.device,
        events=report["romTransferEvents"],
        bad_reads=args.output / "read-diagnostics",
    )
    backend = None
    engine_started = False
    stock_touched = False
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
                args.device, CASE_SERIAL, "left" if args.route == "both" else args.route
            )
            stock_touched = True
            stock = args.case_reference.read_bytes()[32:]
            print("PREFLIGHT: full original case code", flush=True)
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
            report["mirrorBackups"].append(
                {"address": hex(address), "file": filename, "sha256": sha(data)}
            )
        for page, pair in enumerate(pages):
            for kind, data in zip(("original", "patched"), pair):
                (args.output / f"{kind}-{ADDRESSES[page]:08x}.bin").write_bytes(data)
        restore_args = [sys.executable, str(Path(__file__).resolve()), "--device", args.device]
        for name in (
            "build",
            "plan",
            "hello_build",
            "case_reference",
            "staging_qualification",
        ):
            restore_args.extend(
                ["--" + name.replace("_", "-"), str(getattr(args, name).resolve())]
            )
        restore_args.extend(
            [
                "--restore-only-from",
                str(args.output.resolve()),
                "--output",
                str(args.output.resolve()) + "-restore",
            ]
        )
        (args.output / "restore-command.txt").write_text(shlex.join(restore_args) + "\n")
        backend = CaseBackend(
            args,
            report,
            writer,
            pages,
            hello,
            original,
            mirrors,
            frozen,
            loader=loader,
        )
        backend.save()
        engine_started = True
        result = trial(
            backend,
            [pair[0] for pair in pages],
            [pair[1] for pair in pages],
            restore_only=bool(args.restore_only_from),
        )
        report["transaction"] = result
        restored = (
            result["fullStockVerified"]
            and result["sramRestored"]
            and result["stockBooted"]
            and not result["restoreErrors"]
        )
        if args.restore_only_from and restored:
            report["outcome"] = "restore-only-verified"
        elif result["context"] and restored and not result["error"]:
            report["outcome"] = (
                "sbl-status-observed-and-stock-restored"
                if report["validSblStatusFrames"]
                else "hello-probes-complete-stock-restored-no-status"
            )
        elif restored:
            report["outcome"] = "stock-restored-hello-not-qualified"
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
    print(
        json.dumps(
            {
                key: value
                for key, value in report.items()
                if key not in ("preflight", "sourceHashes", "romTransferEvents")
            },
            indent=2,
        ),
        flush=True,
    )
    return (
        0
        if report["outcome"]
        in (
            "sbl-status-observed-and-stock-restored",
            "hello-probes-complete-stock-restored-no-status",
            "restore-only-verified",
        )
        else 2
    )


if __name__ == "__main__":
    raise SystemExit(main())
