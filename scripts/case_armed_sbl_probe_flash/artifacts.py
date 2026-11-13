"""Inspect the exact schema-12 case-page writer without serial access."""
import json
import os
from pathlib import Path

from case_armed_sbl_probe_flash.build import load_pages, pages_header, sha, source_paths
from case_native_task_flash.build import CASE_SERIAL
from case_native_task_flash.validate import CASES

ROOT = Path(__file__).resolve().parent


def inspect(build, plan, probe_build, reference):
    report = json.loads((build / "validated-writer.json").read_text())
    payload = (build / "writer.bin").read_bytes()
    if (
        report.get("operation") != "compiled-exact-case-page-writer-schema12-armed-sbl"
        or report.get("schemaVersion") != 12
        or report.get("caseSerial") != CASE_SERIAL
        or report.get("passed") is not True
    ):
        raise ValueError("unqualified schema-12 writer report")
    if (report.get("payloadBytes"), report.get("payloadSha256")) != (len(payload), sha(payload)) or len(payload) >= 0x3800:
        raise ValueError("schema-12 writer identity/bounds differ")
    actual = {os.path.relpath(path, ROOT): sha(path.read_bytes()) for path in source_paths()}
    if actual != report.get("sourceHashes"):
        raise ValueError("schema-12 writer source changed")
    rows = report.get("cases", [])
    if len(rows) != len(CASES) or {row.get("case") for row in rows} != set(CASES) or not all(row.get("passed") is True for row in rows):
        raise ValueError("schema-12 writer controller coverage incomplete")
    if (
        report.get("hardwareQualified") is not False
        or report.get("hostMutationRunnerImplemented") is not False
        or report.get("templeCommandAllowlist") != ["14559de900000800"]
        or report.get("maxTempleBytes") != 32
    ):
        raise ValueError("schema-12 writer proof boundary differs")
    pages = load_pages(plan, probe_build, reference)
    header = (build / "pages.h").read_bytes()
    if header != pages_header(pages) or sha(header) != report.get("pagesHeaderSha256"):
        raise ValueError("schema-12 compiled page header changed")
    return report, payload, pages
