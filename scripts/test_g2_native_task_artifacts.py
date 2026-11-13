"""Fail-closed artifact inspection before any future flash transport is built."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from case_native_task_recovery.artifacts import inspect_build

class ArtifactTests(unittest.TestCase):
    def setUp(self):
        if not os.environ.get('G2_NATIVE_TASK_BUILD') or not os.environ.get('G2_NATIVE_TASK_REFERENCE'):
            self.skipTest('explicit compiled artifact/reference paths required')
        self.build=Path(os.environ['G2_NATIVE_TASK_BUILD'])
        self.reference=Path(os.environ['G2_NATIVE_TASK_REFERENCE'])
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.copy=Path(self.temp.name)/'copy';shutil.copytree(self.build,self.copy)

    def manifest(self,change):
        path=self.copy/'validated-manifest.json';m=json.loads(path.read_text());change(m);path.write_text(json.dumps(m))

    def test_validated_bundle(self):
        m,b=inspect_build(self.copy,self.reference)
        self.assertTrue(m['compiledValidationComplete']);self.assertEqual(len(b['trampoline']),100)

    def test_incomplete_case_coverage_rejected(self):
        self.manifest(lambda m:m['cases'].pop())
        with self.assertRaises(ValueError):inspect_build(self.copy,self.reference)

    def test_missing_source_pin_rejected(self):
        self.manifest(lambda m:m['sourceHashes'].pop('validate.py'))
        with self.assertRaises(ValueError):inspect_build(self.copy,self.reference)

    def test_hardware_claim_rejected(self):
        self.manifest(lambda m:m.update(hardwareNativeTaskExecutionVerified=True))
        with self.assertRaises(ValueError):inspect_build(self.copy,self.reference)

    def test_tampered_payload_rejected(self):
        path=self.copy/'hook.bin';data=bytearray(path.read_bytes());data[16]^=1;path.write_bytes(data)
        with self.assertRaises(ValueError):inspect_build(self.copy,self.reference)

    def test_outside_callsite_patch_rejected_even_with_updated_digest(self):
        import hashlib
        path=self.copy/'patched-case.bin';data=bytearray(path.read_bytes());data[0x200]^=1;path.write_bytes(data)
        self.manifest(lambda m:m.update(patchedCaseSha256=hashlib.sha256(data).hexdigest()))
        with self.assertRaises(ValueError):inspect_build(self.copy,self.reference)

if __name__=='__main__':unittest.main()
