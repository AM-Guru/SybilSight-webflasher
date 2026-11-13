import json
from pathlib import Path
import unittest

from case_pogo_edge_capture.artifacts import inspect
ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "work/usb-stock-recovery-20261104/goal/case-pogo-edge-capture-build-v1"
REFERENCE = Path("/Users/kalani/Repo/evenRealities-openCFW/g2/blobs/official/g2-2.2.6.10/firmware_box.bin")
EMULATOR = Path("/Users/kalani/Repo/g2-firmware-emulator/work/case-pogo-edge-capture-v1/report.json")


class PogoEdgeCaptureTests(unittest.TestCase):
    def test_artifact_is_rx_only_and_has_raw_pin_counters(self):
        manifest, artifacts = inspect(BUILD, REFERENCE)
        self.assertEqual(manifest["schemaVersion"], 15)
        self.assertEqual(manifest["maxTempleBytesSent"], 0)
        self.assertEqual(manifest["templeCommandAllowlist"], [])
        self.assertEqual(manifest["rawInputPin"], "STM32-PB9")
        self.assertEqual(len(manifest["cases"]), 12)
        self.assertEqual(len(manifest["runtimeCases"]), 8)
        self.assertTrue(artifacts["hook"])

    def test_compiled_hook_distinguishes_edges_from_uart_bytes(self):
        manifest, _ = inspect(BUILD, REFERENCE)
        rows = {row["case"]: row for row in manifest["runtimeCases"]}
        edge = rows["compiled-post-pulse-edges-without-uart"]
        self.assertEqual(edge["evidence"]["totalReceiveBytes"], 0)
        self.assertGreater(edge["rawPb9Observation"]["postPulse"]["transitions"], 0)
        self.assertTrue(edge["rawPb9Observation"]["electricalActivityObserved"])
        quiet = rows["compiled-silence-left-dormant-brr"]
        self.assertEqual(quiet["rawPb9Observation"]["postPulse"]["transitions"], 0)
        self.assertFalse(quiet["rawPb9Observation"]["electricalActivityObserved"])

    def test_stuck_low_is_distinct_from_quiet_high(self):
        manifest, _ = inspect(BUILD, REFERENCE)
        rows = {row["case"]: row for row in manifest["runtimeCases"]}
        low = rows["compiled-stuck-low-without-uart"]["rawPb9Observation"]["postPulse"]
        self.assertEqual(low["lowSamples"], low["samples"])
        self.assertFalse(low["firstLevelHigh"])
        self.assertFalse(low["lastLevelHigh"])

    def test_independent_emulator_rechecks_exact_artifact(self):
        report = json.loads(EMULATOR.read_text())
        self.assertTrue(report["passed"])
        self.assertTrue(report["compiledHookExecuted"])
        self.assertFalse(report["physicalDevicesOpened"])
        self.assertFalse(report["caseFlashWritten"])
        self.assertEqual(report["templeCommandBytesSent"], 0)
        self.assertEqual(len(report["cases"]), 12)
        self.assertEqual(len(report["runtimeCases"]), 8)


if __name__ == "__main__":
    unittest.main()
