import tempfile
from pathlib import Path
import unittest

from audit_g2_even_bootlog_route import build_audit
from g2_even_bootlog import (
    APP_DECISION,
    BOOT_BANNER,
    OTA_FLAG_PREFIX,
    UPDATE_DECISION,
    classify_even_bootloader_log,
)


OPENCFW = Path("/Users/kalani/Repo/evenRealities-openCFW")


class EvenBootlogTests(unittest.TestCase):
    def test_update_path_exact_markers(self):
        result = classify_even_bootloader_log(
            b"noise" + BOOT_BANNER + b"\r\n" + OTA_FLAG_PREFIX + b"55555555\r\n" + UPDATE_DECISION
        )
        self.assertTrue(result["evenBootloaderLogObserved"])
        self.assertTrue(result["bootBannerObserved"])
        self.assertTrue(result["otaFlagLogObserved"])
        self.assertEqual(result["managerDecision"], "install-staged-image")

    def test_application_path_is_not_misclassified_as_update(self):
        result = classify_even_bootloader_log(BOOT_BANNER + b"\n" + APP_DECISION)
        self.assertEqual(result["managerDecision"], "go-to-app")
        self.assertFalse(result["conflictingDecisionMarkers"])

    def test_binary_sbl_frame_and_truncated_markers_are_not_bootlog_evidence(self):
        for raw in (bytes(range(96)), BOOT_BANNER[:-1], b"otaFlag", b"need updata"):
            with self.subTest(raw=raw):
                self.assertFalse(classify_even_bootloader_log(raw)["evenBootloaderLogObserved"])

    def test_input_must_be_bytes(self):
        with self.assertRaises(TypeError):
            classify_even_bootloader_log(bytearray(BOOT_BANNER))

    def test_opencfw_sources_bind_logger_to_application_pogo_uart(self):
        report = build_audit(OPENCFW)
        self.assertEqual((report["apolloRxPin"], report["apolloTxPin"]), (42, 44))
        self.assertEqual(report["nominalBaud"], 1_000_000)
        self.assertTrue(report["sameAsApplicationCaseUart2"])
        self.assertFalse(report["physicalRouteVerified"])
        self.assertEqual(report["firmwareBytesSent"], 0)


if __name__ == "__main__":
    unittest.main()
