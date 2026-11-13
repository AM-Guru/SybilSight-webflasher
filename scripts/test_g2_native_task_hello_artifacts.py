"""Fail-closed checks for the schema-11, HELLO-only native-task bundle."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

from case_native_task_hello.artifacts import inspect_build


class HelloArtifactTests(unittest.TestCase):
    def setUp(self):
        build = os.environ.get("G2_NATIVE_HELLO_BUILD")
        reference = os.environ.get("G2_NATIVE_TASK_REFERENCE")
        if not build or not reference:
            self.skipTest("explicit HELLO build/reference paths required")
        self.reference = Path(reference)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.copy = Path(self.temp.name) / "copy"
        shutil.copytree(Path(build), self.copy)

    def manifest(self, change):
        path = self.copy / "validated-manifest.json"
        manifest = json.loads(path.read_text())
        change(manifest)
        path.write_text(json.dumps(manifest))

    def test_validated_bundle_has_bounded_read_only_scope(self):
        manifest, artifacts = inspect_build(self.copy, self.reference)
        self.assertEqual(manifest["templeCommandAllowlist"], ["14559de900000800"])
        self.assertEqual(manifest["maxTempleBytes"], 160)
        self.assertFalse(manifest["rtosTickReconfigured"])
        self.assertFalse(manifest["glassesFirmwareWriteImplemented"])
        self.assertFalse(manifest["hardwareValidated"])
        self.assertEqual(len(manifest["cases"]), 40)
        self.assertEqual(len(artifacts["trampoline"]), 100)

    def test_incomplete_emitted_case_coverage_rejected(self):
        self.manifest(lambda manifest: manifest["cases"].pop())
        with self.assertRaises(ValueError):
            inspect_build(self.copy, self.reference)

    def test_missing_source_provenance_rejected(self):
        self.manifest(lambda manifest: manifest["sourceHashes"].pop("protocol.py"))
        with self.assertRaises(ValueError):
            inspect_build(self.copy, self.reference)

    def test_hardware_validation_claim_rejected(self):
        self.manifest(lambda manifest: manifest.update(hardwareValidated=True))
        with self.assertRaises(ValueError):
            inspect_build(self.copy, self.reference)

    def test_expanded_temple_command_scope_rejected(self):
        self.manifest(
            lambda manifest: manifest["templeCommandAllowlist"].append("00000000")
        )
        with self.assertRaises(ValueError):
            inspect_build(self.copy, self.reference)

    def test_expanded_transmit_bound_rejected(self):
        self.manifest(lambda manifest: manifest.update(maxTempleBytes=161))
        with self.assertRaises(ValueError):
            inspect_build(self.copy, self.reference)

    def test_tick_or_firmware_write_claim_rejected(self):
        self.manifest(
            lambda manifest: manifest.update(
                rtosTickReconfigured=True, glassesFirmwareWriteImplemented=True
            )
        )
        with self.assertRaises(ValueError):
            inspect_build(self.copy, self.reference)

    def test_tampered_payload_rejected(self):
        path = self.copy / "hook.bin"
        data = bytearray(path.read_bytes())
        data[16] ^= 1
        path.write_bytes(data)
        with self.assertRaises(ValueError):
            inspect_build(self.copy, self.reference)

    def test_outside_exact_patch_scope_rejected_even_with_new_digest(self):
        path = self.copy / "patched-case.bin"
        data = bytearray(path.read_bytes())
        data[0x200] ^= 1
        path.write_bytes(data)
        self.manifest(
            lambda manifest: manifest.update(
                patchedCaseSha256=hashlib.sha256(data).hexdigest()
            )
        )
        with self.assertRaises(ValueError):
            inspect_build(self.copy, self.reference)


if __name__ == "__main__":
    unittest.main()
