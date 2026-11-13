from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import g2_seated_reset_control as control


class SeatedResetControlTests(unittest.TestCase):
    def test_setup_failure_uses_strict_zero_write_restore_proof(self):
        error = ValueError("bridge setup status 3: transient")
        error.bridge_failure_evidence = {
            "retained_result": {"zero_write_setup_stop_verified": True},
            "baseline_hex": "811104afaf03812033ff",
            "restored_hex": "",
            "case_application_version": "1.2.57",
            "cleanup_errors": [],
        }
        verified, evidence = control.setup_failure_restoration(error)
        self.assertTrue(verified)
        self.assertIs(evidence, error.bridge_failure_evidence)
        error.bridge_failure_evidence["cleanup_errors"] = ["restore failed"]
        self.assertFalse(control.setup_failure_restoration(error)[0])

    def test_read_only_recheck_uses_no_reset(self):
        with TemporaryDirectory() as directory:
            with (
                patch.object(control, "preflight", return_value={
                    "caseSerial": control.CASE_SERIAL, "case_version": "1.2.57",
                    "left_present": True, "right_present": True, "ota_glasses": 0,
                }),
                patch.object(control, "reset_both_temples_and_recheck") as reset,
                patch.object(control, "query_route", side_effect=lambda _d, route: {
                    "route": route, "versionReply": None, "caseRouteRestored": True,
                }),
            ):
                result = control.run(
                    "fake-device", Path(directory) / "audit.json", send_reset=False
                )
            reset.assert_not_called()
            self.assertEqual(result["resetCommandsSent"], 0)
            self.assertEqual(result["outcome"], "one-or-more-application-replies-missing")

    def test_one_reset_then_both_read_only_routes(self):
        events = []
        with TemporaryDirectory() as directory:
            with (
                patch.object(control, "preflight", side_effect=lambda *a: {
                    "caseSerial": control.CASE_SERIAL,
                    "case_version": "1.2.57",
                    "left_present": True,
                    "right_present": True,
                    "ota_glasses": 0,
                }),
                patch.object(control, "reset_both_temples_and_recheck",
                             side_effect=lambda *a: events.append("reset") or {"reset_confirmed": True}),
                patch.object(control, "query_route",
                             side_effect=lambda _d, route: events.append(route) or {
                                 "route": route, "versionReply": None,
                                 "caseRouteRestored": True,
                             }),
            ):
                result = control.run("fake-device", Path(directory) / "audit.json")
            self.assertEqual(events, ["reset", "left", "right"])
            self.assertEqual(result["resetCommandsSent"], 1)
            self.assertEqual(result["templeFirmwareImageBytesSent"], 0)
            self.assertEqual(result["outcome"], "one-or-more-application-replies-missing")

    def test_preflight_failure_never_resets(self):
        with TemporaryDirectory() as directory:
            with (
                patch.object(control, "preflight", side_effect=ValueError("no contacts")),
                patch.object(control, "reset_both_temples_and_recheck") as reset,
            ):
                result = control.run("fake-device", Path(directory) / "audit.json")
            reset.assert_not_called()
            self.assertEqual(result["resetCommandsSent"], 0)
            self.assertEqual(result["outcome"], "failed-closed")

    def test_uncertain_reset_is_never_replayed(self):
        with TemporaryDirectory() as directory:
            with (
                patch.object(control, "preflight", return_value={"left_present": True, "right_present": True}),
                patch.object(control, "reset_both_temples_and_recheck",
                             side_effect=TimeoutError("ack lost")) as reset,
                patch.object(control, "query_route") as query,
            ):
                result = control.run("fake-device", Path(directory) / "audit.json")
            self.assertEqual(reset.call_count, 1)
            query.assert_not_called()
            self.assertEqual(result["resetCommandsSent"], 1)
            self.assertEqual(result["outcome"], "failed-closed")


if __name__ == "__main__":
    unittest.main()
