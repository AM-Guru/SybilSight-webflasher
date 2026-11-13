import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from case_sbl_stock_writer.endpoint import inspect_target_probe


STATUS = bytes(range(96))


def decoded(route="left", status=STATUS):
    return {
        "probeQualified": True,
        "route": route,
        "brr": 556,
        "discovery": {"statusFrames": [{"frameHex": status.hex(), "maxStorage": 4_000_000}]},
    }


class EndpointBindingTests(unittest.TestCase):
    def fixture(self, root: Path, source: Path):
        result = bytes(512)
        (root / "armed-sbl-left-result.bin").write_bytes(result)
        report = {
            "operation": "schema12-armed-insertion-sbl-probe",
            "schemaVersion": 12,
            "caseSerial": "002300405845501620373941",
            "outcome": "armed-sbl-status-observed-stock-restored",
            "validSblStatusFrames": 1,
            "sblEndpointVerified": True,
            "templeFirmwareImageBytes": 0,
            "physicalApolloResetVerified": False,
            "probeBaud": 115_200,
            "stockVersionRestored": "1.2.57",
            "sourceHashes": {str(source): hashlib.sha256(source.read_bytes()).hexdigest()},
            "transaction": {
                "fullStockVerified": True,
                "sramRestored": True,
                "stockBooted": True,
                "restoreErrors": [],
            },
        }
        audit = json.dumps(report, sort_keys=True).encode()
        (root / "audit.json").write_bytes(audit)
        return hashlib.sha256(audit).hexdigest()

    def test_exact_probe_binds_status_and_route(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.py"
            source.write_text("stable\n")
            audit_sha = self.fixture(root, source)
            with patch("case_sbl_stock_writer.endpoint.decode", return_value=decoded()):
                result = inspect_target_probe(
                    root, "left", expected_audit_sha256=audit_sha,
                    expected_status_sha256=hashlib.sha256(STATUS).hexdigest(),
                )
            self.assertEqual(result["statusFrame"], STATUS)
            self.assertEqual(result["route"], "left")
            self.assertFalse(result["firmwareWriteAuthorized"])

    def test_drift_route_or_restore_failure_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.py"
            source.write_text("stable\n")
            audit_sha = self.fixture(root, source)
            source.write_text("changed\n")
            with patch("case_sbl_stock_writer.endpoint.decode", return_value=decoded()):
                with self.assertRaisesRegex(ValueError, "changed"):
                    inspect_target_probe(
                        root, "left", expected_audit_sha256=audit_sha,
                        expected_status_sha256=hashlib.sha256(STATUS).hexdigest(),
                    )

            source.write_text("stable\n")
            with patch("case_sbl_stock_writer.endpoint.decode", return_value=decoded("right")):
                with self.assertRaisesRegex(ValueError, "not qualified"):
                    inspect_target_probe(
                        root, "left", expected_audit_sha256=audit_sha,
                        expected_status_sha256=hashlib.sha256(STATUS).hexdigest(),
                    )


if __name__ == "__main__":
    unittest.main()
