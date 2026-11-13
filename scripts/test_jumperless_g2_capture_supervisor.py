"""Supervisor must restore virtual wiring even when Case capture fails."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import jumperless_g2_capture_supervisor as supervisor
from scripts.test_jumperless_reset_audio_capture import qualifier


class JumperlessCaptureSupervisorTests(unittest.TestCase):
    def test_capture_exception_still_attempts_board_restore(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            board = base / "usbmodemJLV5port5"
            board.touch()
            q = base / "qualification.json"
            q.write_text(json.dumps(qualifier()))
            route_dir = base / "route"
            route_dir.mkdir()
            (route_dir / "route-device.py").write_text("print('route')\n")
            (route_dir / "restore-device.py").write_text("print('restore')\n")
            calls = []

            def board_run(port, script, marker, route):
                calls.append(marker)
                return {"payload": {"route": route}}

            with (
                patch.object(supervisor, "find_exact_audio_device", return_value=1),
                patch.object(supervisor, "run_board_script", side_effect=board_run),
                patch.object(supervisor, "record_one", side_effect=RuntimeError("capture failed")),
            ):
                report = supervisor.supervise(
                    str(board), "/dev/cu.fakecase", "left", q, route_dir, base / "output"
                )
            self.assertEqual(calls, ["G2JL_ROUTED=", "G2JL_RESTORED="])
            self.assertTrue(report["boardRestored"])
            self.assertEqual(report["caseResetCommandsAttempted"], 0)
            self.assertEqual(report["outcome"], "failed-before-confirmed-capture")
            self.assertTrue((base / "output" / "supervisor.json").exists())

    def test_missing_board_refuses_before_route(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            q = base / "qualification.json"
            q.write_text(json.dumps(qualifier()))
            with self.assertRaisesRegex(ValueError, "unavailable"):
                supervisor.supervise(
                    "/dev/cu.usbmodemJLV5port5", "/dev/cu.fakecase", "left",
                    q, base / "missing-route", base / "output"
                )
            self.assertFalse((base / "output").exists())


if __name__ == "__main__":
    unittest.main()
