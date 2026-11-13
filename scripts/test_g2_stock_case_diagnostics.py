import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import g2_stock_case_diagnostics as diag


SERIAL = "0123456789ABCDEF01234567"
PREFLIGHT = (f"B200 1.2.57 {SERIAL}\r\nGLS_L:1, GLS_R:1 otaGls:0\r\n").encode()
# Exact complete version response observed on the secondary left temple.
VERSION = bytes.fromhex("5aa5ff09240103050202060a054d")


class FakePort:
    is_open = False

    def __init__(self):
        self.writes = []

    def open(self):
        self.is_open = True

    def close(self):
        self.is_open = False

    def write(self, packet):
        self.writes.append(packet)
        return len(packet)

    def flush(self):
        pass

    def reset_input_buffer(self):
        pass


class StockCaseDiagnosticsTests(unittest.TestCase):
    def test_observed_frame_survives_console_noise_and_request_echo(self):
        noise = b"24 00 00 00 a6\r\n" + diag.VERSION_REQUESTS["left"]
        found = diag.decode_versions(noise + VERSION + b"L charging:1\r\n")
        self.assertEqual(found[0]["firmware"], "2.2.6.10")
        self.assertEqual(found[0]["hardware"], 5)
        self.assertEqual(found[0]["offset"], len(noise))
        self.assertEqual(diag.decode_versions(noise), [])

    def test_corruption_and_every_truncation_rejected(self):
        for index in range(len(VERSION)):
            bad = bytearray(VERSION)
            bad[index] ^= 1
            self.assertEqual(diag.decode_versions(bytes(bad)), [], index)
            self.assertEqual(diag.decode_versions(VERSION[:index]), [], index)

    def test_other_valid_response_types_rejected(self):
        from g2_pogo_protocol import build_response
        self.assertEqual(diag.decode_versions(build_response(0x52, 0)), [])

    def test_latest_identity_presence_and_ota_are_required(self):
        self.assertTrue(diag.check_preflight(PREFLIGHT, SERIAL)["bothContactsPresent"])
        for suffix in (b"B200 1.2.58\n", b"GLS_L:1, GLS_R:0\n", b"otaGls:1\n",
                       b"B200 1.2.57 000000000000000000000000\n"):
            with self.assertRaises(ValueError):
                diag.check_preflight(PREFLIGHT + suffix, SERIAL)
        for raw in (b"", PREFLIGHT.replace(b"otaGls:0", b""),
                    PREFLIGHT.replace(SERIAL.encode(), b"")):
            with self.assertRaises(ValueError):
                diag.check_preflight(raw, SERIAL)

    def test_only_fixed_read_only_requests_can_be_sent(self):
        port = FakePort()
        for packet in (b"DEB0\n", b"\x7f", b"", bytes.fromhex("52000000d3")):
            with self.assertRaises(ValueError):
                diag.send_fixed(port, packet)
        self.assertEqual(port.writes, [])

    def test_failed_identity_sends_no_temple_request_and_closes_port(self):
        port = FakePort()
        with tempfile.TemporaryDirectory() as folder, patch.object(
            diag, "read_for", side_effect=[PREFLIGHT, b"", b""]
        ):
            audit = diag.run_session(port, "0" * 24, Path(folder))
            self.assertEqual(audit["outcome"], "failed-closed")
            self.assertEqual(port.writes, list(diag.DIAGNOSTICS))
            self.assertFalse(port.is_open)
            self.assertEqual(json.loads((Path(folder) / "audit.json").read_text()), audit)

    def test_partial_reply_is_recorded_without_authorizing_a_write(self):
        port = FakePort()
        with tempfile.TemporaryDirectory() as folder, patch.object(
            diag, "read_for", side_effect=[PREFLIGHT, b"", b"", b"", VERSION, b"", b"receive header timeout"]
        ):
            audit = diag.run_session(port, SERIAL, Path(folder))
            self.assertEqual(audit["outcome"], "partial-version-replies")
            self.assertFalse(audit["firmwareWriteAuthorized"])
            self.assertFalse(audit["physicalTempleResetVerified"])
            self.assertFalse(port.is_open)
            self.assertEqual(audit["queries"][1]["receiveHeaderTimeouts"], 1)
            self.assertEqual(port.writes, list(diag.DIAGNOSTICS) + list(diag.VERSION_REQUESTS.values()))

    def test_serial_failure_after_open_still_closes_port(self):
        port = FakePort()
        with tempfile.TemporaryDirectory() as folder, patch.object(diag, "read_for", side_effect=OSError("USB lost")):
            audit = diag.run_session(port, SERIAL, Path(folder))
            self.assertEqual(audit["outcome"], "failed-closed")
            self.assertFalse(port.is_open)


if __name__ == "__main__":
    unittest.main()
