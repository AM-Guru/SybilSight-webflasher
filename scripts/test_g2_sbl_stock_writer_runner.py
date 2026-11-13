from pathlib import Path
import unittest

from case_sbl_stock_writer.run_writer import (
    QualifiedExecutionFailure,
    execute_qualified,
    expected_stock_version,
)
from g2_sbl_writer import DEVICE_RISK_TOKEN, FIRMWARE_RISK_TOKEN, SblWriteFailure


class FakeTransport:
    instances = []

    def __init__(self, *args, **kwargs):
        self.restore_verified = False
        self.application_version = None
        self.close_error = None
        self.closed = False
        self.__class__.instances.append(self)

    def close(self):
        self.closed = True
        self.restore_verified = True
        self.application_version = "1.2.57"


class RunnerTests(unittest.TestCase):
    def args(self):
        return dict(
            device="/dev/fake", route="left", build=Path("build"),
            stock_image=Path("stock"), image=b"image",
            image_sha256="d6d29ec6a6d7d3f7e0abb260c54493e2e5dd0ed978346dc41061ee6522d40fc6",
            status_frame=bytes(96), bridge_sha256="bb" * 32,
            baud=115_200,
            device_risk_token=DEVICE_RISK_TOKEN,
            firmware_risk_token=FIRMWARE_RISK_TOKEN,
            transport_class=FakeTransport,
        )

    def setUp(self):
        FakeTransport.instances.clear()

    def test_success_requires_write_case_restore_and_postflight(self):
        write = {"firmwareImageBytesAttempted": 5, "outcome": "reset-acknowledged-postflight-required"}
        result = execute_qualified(
            **self.args(), writer=lambda *args, **kwargs: write,
            postflight=lambda *args, **kwargs: {"passed": kwargs["expected_version"] == "2.3.2.14"},
        )
        self.assertIs(result["write"], write)
        self.assertTrue(result["caseRestoreVerified"])
        self.assertTrue(result["targetStockApplicationResponsive"])
        self.assertFalse(result["glassesRecovered"])
        self.assertTrue(FakeTransport.instances[0].closed)

    def test_unpinned_stock_image_fails_before_transport_or_write(self):
        args = self.args()
        args["image_sha256"] = "aa" * 32
        with self.assertRaisesRegex(ValueError, "no pinned postflight version"):
            execute_qualified(**args)
        self.assertEqual(FakeTransport.instances, [])

    def test_postflight_failure_cannot_report_recovery(self):
        write = {"firmwareImageBytesAttempted": 5}
        with self.assertRaisesRegex(QualifiedExecutionFailure, "liveness was not verified") as caught:
            execute_qualified(
                **self.args(), writer=lambda *args, **kwargs: write,
                postflight=lambda *args, **kwargs: {"passed": False},
            )
        self.assertIs(caught.exception.execution_result["write"], write)
        self.assertTrue(caught.exception.execution_result["caseRestoreVerified"])
        self.assertFalse(caught.exception.execution_result["glassesRecovered"])
        self.assertTrue(FakeTransport.instances[0].closed)

    def test_pinned_image_versions(self):
        self.assertEqual(expected_stock_version("36c5b0e499a68ac2493a497bdab9740fd3e7027730c26a9094eca47268a27863"), "2.2.6.10")
        self.assertEqual(expected_stock_version(self.args()["image_sha256"]), "2.3.2.14")
        self.assertEqual(expected_stock_version("33f9eb7a47f996b8bcf34ac9df8bc2f7b698a6512cbf370d25b3215ad0dde298"), "2.4.0.24")

    def test_writer_failure_still_closes_and_never_runs_postflight(self):
        called = []

        def writer(*args, **kwargs):
            raise SblWriteFailure("stopped", {"outcome": "data-ambiguous"})

        with self.assertRaises(SblWriteFailure) as caught:
            execute_qualified(
                **self.args(), writer=writer,
                postflight=lambda *args: called.append(True),
            )
        self.assertTrue(FakeTransport.instances[0].closed)
        self.assertTrue(caught.exception.execution_result["caseRestoreVerified"])
        self.assertEqual(called, [])

    def test_incomplete_case_restore_blocks_postflight(self):
        class BadRestore(FakeTransport):
            def close(self):
                self.closed = True
                self.close_error = "unverified"

        called = []
        args = self.args()
        args["transport_class"] = BadRestore
        with self.assertRaisesRegex(QualifiedExecutionFailure, "restoration failed") as caught:
            execute_qualified(
                **args, writer=lambda *a, **k: {},
                postflight=lambda *a: called.append(True),
            )
        self.assertEqual(caught.exception.execution_result["caseRestoreError"], "unverified")
        self.assertEqual(called, [])


if __name__ == "__main__":
    unittest.main()
