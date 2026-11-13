#!/usr/bin/env python3
"""Live mode-2 qualification for schema-17 staging; never mutates Case flash."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from case_output_off_reset_sbl_hello.writer_artifacts import inspect_writer
from case_native_task_flash.build import CASE_SERIAL
from case_native_task_flash.protocol import decode, request
from case_native_task_flash.stager import BASE, SIZE, Stager
from case_sbl_discovery.run import preflight
from g2_case_rom import BootloaderError, go_sram, restore_application


ADDRESSES = (0x08009800, 0x0800D800)


def sha(data):
    import hashlib
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    for name in ("build", "plan", "probe-build", "case-reference", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")
    _manifest, payload, pages = inspect_writer(
        args.build, args.plan, args.probe_build, args.case_reference
    )
    paths = [
        Path(__file__),
        Path(__file__).resolve().parent / "writer_artifacts.py",
        Path(__file__).resolve().parent / "build_writer.py",
        Path(__file__).resolve().parents[1] / "case_native_task_flash/stager.py",
        Path(__file__).resolve().parents[1] / "case_native_task_flash/protocol.py",
        Path(__file__).resolve().parents[1] / "case_native_task_recovery/rom_epochs.py",
        Path(__file__).resolve().parents[1] / "case_sbl_discovery/run.py",
        Path(__file__).resolve().parents[1] / "g2_case_rom.py",
        args.build / "writer.bin",
        args.build / "pages.h",
        args.build / "validated-writer.json",
        args.plan / "plan.json",
        args.probe_build / "validated-manifest.json",
        args.probe_build / "hook.bin",
        args.probe_build / "trampoline.bin",
        args.probe_build / "patched-case.bin",
        args.case_reference,
    ]
    frozen = {str(path.resolve()): sha(path.read_bytes()) for path in paths}
    args.output.mkdir(parents=True)
    report = {
        "operation": "schema17-seated-yhm-edge-changed-range-staging-qualification",
        "schemaVersion": 17,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "caseSerial": CASE_SERIAL,
        "writerPayloadSha256": sha(payload),
        "sourceHashes": frozen,
        "rows": [],
        "romTransferEvents": [],
        "flashWrites": 0,
        "templeCommandBytes": 0,
        "glassesFirmwareImageBytes": 0,
        "outcome": "not-started",
    }
    stager = Stager(
        args.device,
        events=report["romTransferEvents"],
        bad_reads=args.output / "read-diagnostics",
    )
    original = None
    dirty = touched = False
    try:
        report["preflight"] = preflight(args.device, CASE_SERIAL, "left")
        if not report["preflight"]["left_present"] or not report["preflight"]["right_present"]:
            raise ValueError("schema-17 staging qualification requires both temples seated")
        touched = True
        stock = args.case_reference.read_bytes()[32:]
        stager.verify(0x08000000, stock, label="preflight stock")
        for page, address in enumerate(ADDRESSES):
            stager.verify(address, pages[page][0], label="original case page")
        original = stager.read(BASE, SIZE)
        (args.output / "original-sram.bin").write_bytes(original)
        report["originalSramSha256"] = sha(original)
        for page in (0, 1):
            cfg = request(page, 2, 0x50150001 + page)
            dirty = True
            before = stager.bytes_written
            stager.stage_writer(payload, cfg)
            stager.verify(BASE, payload, label="complete SRAM writer")
            if any(sha(Path(name).read_bytes()) != digest for name, digest in frozen.items()):
                raise ValueError("schema-17 qualification source/input changed")
            with stager.connect(verify_address=0x20013F00, expected=cfg) as port:
                try:
                    go_sram(port)
                    acknowledged = True
                except (BootloaderError, OSError):
                    acknowledged = False
                finally:
                    port.dtr = True
                    time.sleep(0.25)
            raw = stager.read(0x20013A00, 256)
            result = decode(raw)
            (args.output / f"page{page}-result.bin").write_bytes(raw)
            if (
                result["status"]
                or result["mode"] != 2
                or result["page"] != page
                or result["nonce"] != 0x50150001 + page
                or result["eraseStarts"]
                or result["programDoublewords"]
                or result["busyAtEnd"]
            ):
                raise ValueError("schema-17 mode-2 evidence not qualified")
            stager.verify(0x20013F00, bytes(8), label="consumed mode-2 request")
            report["rows"].append({
                "page": page,
                "launchAcknowledged": acknowledged,
                "result": result,
                "stagingBytesAttempted": stager.bytes_written - before,
            })
        for page, address in enumerate(ADDRESSES):
            stager.verify(address, pages[page][0], label="unchanged original case page")
        report["candidatePagesUnchanged"] = True
        report["outcome"] = "mode2-and-original-restore-verified"
    except Exception as error:
        report["error"] = str(error)
        report["outcome"] = "failed-closed"
    finally:
        report["stagingBytesAttemptedBeforeRestore"] = stager.bytes_written
        if dirty and original is not None:
            try:
                stager.restore(original)
                report["originalSramRestoredAndVerified"] = True
            except Exception as error:
                report["sramRestoreError"] = str(error)
                report["outcome"] = "sram-restore-unverified"
        if touched:
            try:
                report["stockVersionRestored"] = restore_application(
                    args.device, expected_version="1.2.57"
                )
            except Exception as error:
                report["stockRestoreError"] = str(error)
                report["outcome"] = "stock-restore-unverified"
        report["totalSramBytesAttempted"] = stager.bytes_written
        report["unchangedEpochsSkipped"] = stager.epochs_skipped
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        (args.output / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({
        key: value for key, value in report.items()
        if key not in ("sourceHashes", "preflight", "romTransferEvents")
    }, indent=2), flush=True)
    return 0 if report["outcome"] == "mode2-and-original-restore-verified" else 2


if __name__ == "__main__":
    raise SystemExit(main())
