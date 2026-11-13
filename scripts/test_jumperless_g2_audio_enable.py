"""Exact-tag Jumperless audio enable and post-enumeration verification."""
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import subprocess

from scripts import jumperless_g2_audio_enable as enable
from scripts.test_jumperless_g2_audio_route import inventory


class JumperlessAudioEnableTests(unittest.TestCase):
    def test_helper_timeout_is_recorded_for_postflight_decision(self):
        with patch.object(enable.subprocess, "run", side_effect=subprocess.TimeoutExpired("helper", 15)):
            reply = enable.run_device_file("/dev/cu.usbmodemJLV5port5", Path("/tmp/a.py"))
        self.assertEqual(reply["exitCode"], -1)
        self.assertIn("re-enumeration", reply["stderr"])

    def test_device_code_checks_baseline_and_sets_capture_mode(self):
        before = inventory()
        before["usbAudioIsEnabled"]["value"] = False
        before["usbAudioStatus"]["value"]["enabled"] = False
        before["usbAudioSetupAvailable"] = True
        code = enable.build_enable_code(before)
        calls = []
        board = types.ModuleType("jumperless")
        board.get_num_bridges = lambda: 1
        board.get_bridge = lambda index: (102, 108, -1)
        board.dac_get = lambda channel: 0.0
        namespace = {
            "usb_audio_status": lambda: {"streaming": False},
            "usb_audio_set_rate": lambda hz: calls.append(("rate", hz)) or True,
            "usb_audio_setup": lambda *args: calls.append(("setup", args)) or True,
        }
        with patch.dict(sys.modules, {"jumperless": board}):
            exec(code, namespace)
        self.assertEqual(calls, [("rate", 16000), ("setup", (0, 1, 8.0, False))])

    def test_reenumeration_serial_drop_is_not_success_without_postflight(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            board = base / "JLV5port5"
            board.touch()
            before = inventory()
            before["usbAudioSetupAvailable"] = True
            before["usbAudioIsEnabled"]["value"] = False
            before["usbAudioStatus"]["value"]["enabled"] = False
            after = inventory()
            with (
                patch.object(enable, "read_inventory", side_effect=[
                    before, RuntimeError("USB re-enumerating"), after,
                ]),
                patch.object(enable, "run_device_file", return_value={
                    "exitCode": 1, "stdout": "", "stderr": "serial dropped",
                }),
                patch.object(enable, "find_exact_audio_device", return_value=2),
                patch.object(enable.time, "sleep"),
            ):
                report = enable.configure(str(board), base / "audit")
            self.assertEqual(report["outcome"], "audio-ready")
            self.assertTrue(report["audioSetupAttempted"])
            self.assertTrue(report["bridgesUnchanged"])
            self.assertTrue(report["railsUnchanged"])
            self.assertEqual(report["hostAudioDeviceIndex"], 2)
            self.assertTrue((base / "audit" / "audit.json").exists())

    def test_postflight_settings_mismatch_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            board = base / "JLV5port5"
            board.touch()
            before = inventory()
            before["usbAudioSetupAvailable"] = True
            after = inventory()
            after["usbAudioStatus"]["value"]["dc_block"] = True
            with (
                patch.object(enable, "read_inventory", side_effect=[before, after]),
                patch.object(enable, "find_exact_audio_device", return_value=2),
            ):
                report = enable.configure(str(board), base / "audit")
            self.assertEqual(report["outcome"], "audio-not-verified")
            self.assertFalse(report["hostAudioVerified"])


if __name__ == "__main__":
    unittest.main()
