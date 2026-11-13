"""Fail-closed checks for the exact schema-11 HELLO page writer."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

from case_native_task_hello_flash.artifacts import inspect


class HelloFlashArtifactTests(unittest.TestCase):
    def setUp(self):
        required = (
            "G2_NATIVE_HELLO_FLASH_BUILD",
            "G2_NATIVE_HELLO_FLASH_PLAN",
            "G2_NATIVE_HELLO_BUILD",
            "G2_NATIVE_TASK_REFERENCE",
        )
        if any(not os.environ.get(name) for name in required):
            self.skipTest("explicit HELLO writer inputs required")
        self.plan = Path(os.environ["G2_NATIVE_HELLO_FLASH_PLAN"])
        self.hello = Path(os.environ["G2_NATIVE_HELLO_BUILD"])
        self.reference = Path(os.environ["G2_NATIVE_TASK_REFERENCE"])
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.build = Path(self.temp.name) / "build"
        shutil.copytree(Path(os.environ["G2_NATIVE_HELLO_FLASH_BUILD"]), self.build)

    def manifest(self, change):
        path = self.build / "validated-writer.json"
        report = json.loads(path.read_text())
        change(report)
        path.write_text(json.dumps(report))

    def test_exact_writer_bundle(self):
        report, payload, pages = inspect(
            self.build, self.plan, self.hello, self.reference
        )
        self.assertEqual(len(report["cases"]), 27)
        self.assertLess(len(payload), 0x3800)
        self.assertEqual([len(pair[0]) for pair in pages], [2048, 2048])
        self.assertEqual(report["templeCommandAllowlist"], ["14559de900000800"])

    def test_incomplete_controller_coverage_rejected(self):
        self.manifest(lambda report: report["cases"].pop())
        with self.assertRaises(ValueError):
            inspect(self.build, self.plan, self.hello, self.reference)

    def test_hardware_or_host_claim_rejected(self):
        self.manifest(
            lambda report: report.update(
                hardwareQualified=True, hostMutationRunnerImplemented=True
            )
        )
        with self.assertRaises(ValueError):
            inspect(self.build, self.plan, self.hello, self.reference)

    def test_tampered_writer_rejected(self):
        path = self.build / "writer.bin"
        payload = bytearray(path.read_bytes())
        payload[32] ^= 1
        path.write_bytes(payload)
        with self.assertRaises(ValueError):
            inspect(self.build, self.plan, self.hello, self.reference)

    def test_tampered_page_header_rejected_even_with_new_digest(self):
        path = self.build / "pages.h"
        data = bytearray(path.read_bytes())
        data[-10] ^= 1
        path.write_bytes(data)
        self.manifest(
            lambda report: report.update(
                pagesHeaderSha256=hashlib.sha256(data).hexdigest()
            )
        )
        # The header must match the bytes embedded in the compiled writer, not
        # merely a self-consistent report digest. Rebuilding is required.
        with self.assertRaises(ValueError):
            inspect(self.build, self.plan, self.hello, self.reference)


if __name__ == "__main__":
    unittest.main()
