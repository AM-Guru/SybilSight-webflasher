from pathlib import Path
import unittest
from unittest.mock import patch

from case_sbl_stock_writer.transport import Schema13CaseTransport
from g2_case_pogo_flasher import CaseSramTempleTransport
from g2_pogo_flasher import SafetyError, TransportTimeout
from g2_sbl_wire import data_frame, hello_frame, ota_descriptor_frame, reset_frame, update_frame
from g2_sbl_writer import DEVICE_RISK_TOKEN, FIRMWARE_RISK_TOKEN


def response(sequence: int, payload: bytes) -> bytes:
    frame = bytearray(b"G2RX")
    frame.extend((1, sequence, 0, 0, len(payload), 0, 0))
    frame.extend(payload)
    frame.append(sum(frame) & 0xFF)
    return bytes(frame)


class BufferedPort:
    def __init__(self, data: bytes):
        self.data = bytearray(data)

    def read(self, count: int) -> bytes:
        result = bytes(self.data[:count])
        del self.data[:count]
        return result


class Schema13TransportTests(unittest.TestCase):
    def transport(self, stock=b"x" * 1093):
        value = Schema13CaseTransport.__new__(Schema13CaseTransport)
        value._stock = stock
        value._writer_phase = "hello"
        value._next_data_offset = 0
        value._terminal_failure = False
        return value

    def test_risk_tokens_are_checked_before_artifact_or_device_access(self):
        with patch("case_sbl_stock_writer.transport.inspect") as inspected:
            with self.assertRaisesRegex(SafetyError, "risk tokens"):
                Schema13CaseTransport(
                    "/dev/fake", "left", build=Path("missing"),
                    stock_image=Path("missing"), baud=115_200,
                    expected_bridge_sha256="00" * 32,
                    device_risk_token="wrong", firmware_risk_token=FIRMWARE_RISK_TOKEN,
                )
        inspected.assert_not_called()

    def test_exact_one_shot_phase_order_reaches_parent_transport(self):
        transport = self.transport()
        calls = []

        def parent(_self, request, timeout):
            calls.append((bytes(request), timeout))
            return b"reply"

        requests = [
            ("HELLO", hello_frame()),
            ("OTADESC", ota_descriptor_frame()),
            ("UPDATE", update_frame(transport._stock)),
            ("DATA:0", data_frame(0, transport._stock[:997])),
            ("DATA:997", data_frame(997, transport._stock[997:])),
            ("RESET", reset_frame()),
        ]
        with patch.object(CaseSramTempleTransport, "transact", parent):
            for label, request in requests:
                self.assertEqual(
                    transport.transact(request, timeout=12.0, label=label), b"reply"
                )
        self.assertEqual([row[0] for row in calls], [row[1] for row in requests])
        self.assertEqual(transport._writer_phase, "done")

    def test_wrong_frame_or_order_is_terminal_before_parent_io(self):
        for label, request in (("UPDATE", update_frame(b"x")), ("HELLO", b"wrong")):
            transport = self.transport()
            with patch.object(CaseSramTempleTransport, "transact") as parent:
                with self.assertRaises(SafetyError):
                    transport.transact(request, timeout=1.0, label=label)
                with self.assertRaisesRegex(SafetyError, "terminal"):
                    transport.transact(hello_frame(), timeout=1.0, label="HELLO")
            parent.assert_not_called()

    def test_ambiguous_parent_failure_cannot_be_replayed(self):
        transport = self.transport()
        with patch.object(
            CaseSramTempleTransport, "transact", side_effect=TransportTimeout("lost")
        ) as parent:
            with self.assertRaises(TransportTimeout):
                transport.transact(hello_frame(), timeout=1.0, label="HELLO")
            with self.assertRaisesRegex(SafetyError, "terminal"):
                transport.transact(hello_frame(), timeout=1.0, label="HELLO")
        self.assertEqual(parent.call_count, 1)

    def test_header_token_accepts_late_96_byte_status(self):
        transport = self.transport()
        transport.max_capture_bytes = 128
        transport.port = BufferedPort(response(1, bytes(96)) + b"\xc3")
        transport._read_header_flow_token(10**20)
        self.assertEqual(transport.port.data, b"")


if __name__ == "__main__":
    unittest.main()
