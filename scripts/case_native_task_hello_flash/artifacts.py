"""Inspect the exact schema-11 HELLO page writer without serial access."""
import json
import os
from pathlib import Path

from case_native_task_flash.build import CASE_SERIAL
from case_native_task_flash.validate import CASES
from case_native_task_hello_flash.build import load_pages, pages_header, sha, source_paths

ROOT = Path(__file__).resolve().parent


def inspect(build, plan, hello_build, reference):
    report = json.loads((build / "validated-writer.json").read_text())
    payload = (build / "writer.bin").read_bytes()
    if (
        report.get("operation") != "compiled-exact-case-page-writer-schema11-hello"
        or report.get("schemaVersion") != 11
        or report.get("caseSerial") != CASE_SERIAL
        or report.get("passed") is not True
    ):
        raise ValueError("unqualified schema-11 writer report")
    if (
        (report.get("payloadBytes"), report.get("payloadSha256"))
        != (len(payload), sha(payload))
        or len(payload) >= 0x3800
    ):
        raise ValueError("writer identity/bounds differ")
    actual_sources = {
        os.path.relpath(path, ROOT): sha(path.read_bytes()) for path in source_paths()
    }
    if actual_sources != report.get("sourceHashes"):
        raise ValueError("writer/validator source changed")
    rows = report.get("cases", [])
    if (
        len(rows) != len(CASES)
        or {row.get("case") for row in rows} != set(CASES)
        or not all(row.get("passed") is True for row in rows)
    ):
        raise ValueError("incomplete writer coverage")
    if (
        report.get("hardwareQualified") is not False
        or report.get("hostMutationRunnerImplemented") is not False
        or report.get("templeCommandAllowlist") != ["14559de900000800"]
        or report.get("maxTempleBytes") != 160
    ):
        raise ValueError("unexpected writer capability/proof claim")
    pages = load_pages(plan, hello_build, reference)
    header = (build / "pages.h").read_bytes()
    if (
        sha(header) != report.get("pagesHeaderSha256")
        or header != pages_header(pages)
    ):
        raise ValueError("compiled page header changed")
    return report, payload, pages
