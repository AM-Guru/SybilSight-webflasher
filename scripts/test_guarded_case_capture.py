import argparse
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from guarded_case_capture import CASE_SERIAL, load_capture, stock_verified, supervise


class GuardedCaseCaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.capture = self.root / "capture"
        self.capture.mkdir()
        original = bytes(0x8000)
        (self.capture / "original-sram.bin").write_bytes(original)
        self.report = {
            "caseSerial": CASE_SERIAL,
            "caseFlashMayBeChanged": True,
            "sramDirty": True,
            "originalSramSha256": hashlib.sha256(original).hexdigest(),
            "mirrorBackups": [],
            "transaction": {"fullStockVerified": False, "restoreErrors": [{"page": 1}]},
        }
        for address in ("0x8049800", "0x804d800"):
            name = f"mirror-{address}.bin"
            data = bytes(2048)
            (self.capture / name).write_bytes(data)
            self.report["mirrorBackups"].append({
                "address": address, "file": name,
                "sha256": hashlib.sha256(data).hexdigest(),
            })
        (self.capture / "audit.json").write_text(json.dumps(self.report))
        self.args = argparse.Namespace(
            runner=Path(__file__).resolve().parent / "case_output_off_reset_sbl_hello/run_capture.py",
            device="/dev/fake", build=self.root / "build", plan=self.root / "plan",
            probe_build=self.root / "probe", case_reference=self.root / "reference",
            staging_qualification=self.root / "qualification", output=self.capture,
            route="right", launch=False, dry_run=False,
        )

    @staticmethod
    def restored():
        return {
            "caseSerial": CASE_SERIAL, "outcome": "restore-only-verified",
            "transaction": {"fullStockVerified": True, "sramRestored": True,
                            "stockBooted": True, "restoreErrors": []},
            "fullOriginalCodeAndMirrorsVerified": True,
            "originalSramRestoredAndVerified": True,
            "stockVersionRestored": "1.2.57",
            "stockOutputAfterRestoreVerified": True,
            "stockOutputFlagAfterRestore": 1,
            "stockYhmAfterRestore": {"hardwareReg3": 0xAF, "hardwareReg4": 0xAF},
        }

    def test_partial_restore_is_retried_without_replaying_capture(self):
        calls = []

        def invoke(command, *, check):
            self.assertFalse(check)
            self.assertIn("--restore-only-from", command)
            self.assertNotIn("--execute-off-reset-sbl-hello-capture", command)
            destination = Path(command[command.index("--output") + 1])
            destination.mkdir()
            report = {} if not calls else self.restored()
            (destination / "audit.json").write_text(json.dumps(report))
            calls.append(command)
            return SimpleNamespace(returncode=2 if len(calls) == 1 else 0)

        result = supervise(self.args, invoke=invoke)
        self.assertEqual(len(calls), 2)
        self.assertTrue(result["finalStockVerified"])
        self.assertEqual(result["outcome"], "restore-only-verified")
        self.assertTrue((self.capture / "guarded-restore-audit.json").is_file())

    def test_drifted_backup_fails_before_automatic_restore(self):
        (self.capture / "original-sram.bin").write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "original SRAM backup"):
            load_capture(self.capture)

    def test_stock_verification_requires_output_and_sram(self):
        healthy = self.restored()
        self.assertTrue(stock_verified(healthy))
        healthy["stockOutputFlagAfterRestore"] = 0
        self.assertFalse(stock_verified(healthy))


if __name__ == "__main__":
    unittest.main()
