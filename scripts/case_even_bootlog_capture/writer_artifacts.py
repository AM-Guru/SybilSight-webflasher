"""Fail-closed inspection of the offline schema-14 page plan and writer."""

import json
import os
from pathlib import Path

from case_even_bootlog_capture.build_writer import (
    load_pages,
    pages_header,
    sha,
    source_paths,
)
from case_native_task_flash.build import CASE_SERIAL
from case_native_task_flash.validate import CASES


ROOT = Path(__file__).resolve().parent


def inspect_writer(build, plan, probe_build, reference):
    """Re-derive writer identity, source pins, case coverage, and exact pages."""
    report = json.loads((build / "validated-writer.json").read_text())
    payload = (build / "writer.bin").read_bytes()
    if (
        report.get("operation") != "compiled-exact-case-page-writer-schema14-passive-bootlog"
        or report.get("schemaVersion") != 14
        or report.get("caseSerial") != CASE_SERIAL
        or report.get("passed") is not True
        or report.get("hardwareFlashWrites") != 0
        or report.get("hardwareQualified") is not False
        or report.get("hostMutationRunnerImplemented") is not False
        or report.get("templeCommandAllowlist") != []
        or report.get("maxTempleBytesSent") != 0
    ):
        raise ValueError("unqualified schema-14 writer report")
    if (
        report.get("payloadBytes") != len(payload)
        or report.get("payloadSha256") != sha(payload)
        or len(payload) >= 0x3800
    ):
        raise ValueError("schema-14 writer identity or SRAM bounds differ")
    current_sources = {
        os.path.relpath(path, ROOT): sha(path.read_bytes()) for path in source_paths()
    }
    if current_sources != report.get("sourceHashes"):
        raise ValueError("schema-14 writer or validator source changed")
    cases = report.get("cases", [])
    if (
        len(cases) != len(CASES)
        or {row.get("case") for row in cases} != set(CASES)
        or not all(row.get("passed") is True for row in cases)
    ):
        raise ValueError("incomplete schema-14 writer coverage")
    pages = load_pages(plan, probe_build, reference)
    header = (build / "pages.h").read_bytes()
    if header != pages_header(pages) or sha(header) != report.get("pagesHeaderSha256"):
        raise ValueError("compiled schema-14 page header changed")
    return report, payload, pages
