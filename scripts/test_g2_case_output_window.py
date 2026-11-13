import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import scripts.g2_case_output_window as control


PREFLIGHT = {
    "caseSerial": control.CASE_SERIAL,
    "case_version": "1.2.57",
    "left_present": True,
    "right_present": True,
    "ota_glasses": 0,
}


class FakePort:
    is_open = True

    def close(self):
        self.is_open = False


class OutputWindowTests(unittest.TestCase):
    def test_fixed_packet_framing(self):
        self.assertEqual(control.OUTPUT_OFF.hex(), "5aa57f053f00020000c4")
        self.assertEqual(control.OUTPUT_ON.hex(), "5aa57f053f00020001c5")
        self.assertEqual(control.ACK.hex(), "5aa5ff053f0103010047")
        self.assertEqual(control.output_state(b"xxxxxx B200 vol:4100 chEn:1"), 0)
        self.assertEqual(control.output_state(b"****** B200 vol:4100 chEn:0"), 1)

    def test_restores_output_after_success(self):
        port = FakePort()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "audit.json"
            with patch.object(control, "preflight", return_value=PREFLIGHT), \
                 patch.object(control, "_open_case_console", return_value=port), \
                 patch.object(control, "_drain_case_console", return_value=b""), \
                 patch.object(control, "status", return_value=b"****** B200 vol:4100 chEn:1"), \
                 patch.object(control, "send_output", side_effect=[(b"xxxxxx B200 vol:4100 chEn:1", True), (b"****** B200 vol:4100 chEn:1", True)]) as send, \
                 patch.object(control.time, "monotonic", side_effect=[0, 16]):
                result = control.run("test", output, 15)
            self.assertEqual(result["outcome"], "output-window-complete")
            self.assertEqual([call.args[1] for call in send.call_args_list], [control.OUTPUT_OFF, control.OUTPUT_ON])
            self.assertTrue(result["usbPortClosed"])
            self.assertEqual(json.loads(output.read_text())["outcome"], result["outcome"])

    def test_restores_output_after_uncertain_off(self):
        port = FakePort()
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(control, "preflight", return_value=PREFLIGHT), \
                 patch.object(control, "_open_case_console", return_value=port), \
                 patch.object(control, "_drain_case_console", return_value=b""), \
                 patch.object(control, "status", return_value=b"****** B200 vol:4100 chEn:1"), \
                 patch.object(control, "send_output", side_effect=[ValueError("lost off reply"), (b"****** B200 vol:4100 chEn:1", True)]) as send:
                result = control.run("test", Path(directory) / "audit.json", 15)
            self.assertEqual(result["outcome"], "failed-closed")
            self.assertEqual([call.args[1] for call in send.call_args_list], [control.OUTPUT_OFF, control.OUTPUT_ON])
            self.assertTrue(result["onAcknowledgedAndFlagEnabled"])
            self.assertTrue(result["usbPortClosed"])


if __name__ == "__main__":
    unittest.main()
