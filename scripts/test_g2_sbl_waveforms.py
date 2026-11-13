"""Artifact and runtime checks for the bounded PB9 reset candidates."""
import json
from pathlib import Path
import unittest

from case_sbl_reset_prepared.artifacts import inspect_build
from case_sbl_reset_prepared.protocol import parse_ready, ready_bytes
from case_sbl_reset_prepared.waveforms import WAVEFORM_CODES, derive
from case_sbl_reset_prepared.trace import extract


ROOT = Path(__file__).resolve().parents[1]
GOAL = ROOT / "work/usb-stock-recovery-20261104/goal"
REFERENCE = Path("/Users/kalani/Repo/evenRealities-openCFW/g2/blobs/official/g2-2.2.6.10/firmware_box.bin")


class WaveformArtifactTests(unittest.TestCase):
    def test_variants_bind_executed_stock_trace_and_readiness(self):
        base = extract(REFERENCE.read_bytes())
        for variant in WAVEFORM_CODES:
            if variant == "stock":
                continue
            with self.subTest(variant=variant):
                directory = GOAL / f"waveform-left-{variant}-1000000-pinlevel-build-v1"
                manifest, payload = inspect_build(directory)
                self.assertEqual(manifest["resetTrace"], json.loads(json.dumps(derive(base, variant))))
                self.assertEqual(len(manifest["cases"]), 39)
                self.assertTrue(all(row["completed"] for row in manifest["cases"]))
                self.assertTrue(next(row for row in manifest["cases"] if row["case"] == "valid")["sblStatusVerified"])
                self.assertEqual(parse_ready(ready_bytes(manifest), manifest)["waveform"], variant)
                self.assertLess(len(payload), 0x1800)
                self.assertFalse(manifest["firmwareWriteImplemented"])


if __name__ == "__main__":
    unittest.main()
