import hashlib
from pathlib import Path
import struct
import unittest
import zlib

from g2_sbl_wire import G2_OTA_DESCRIPTOR_ADDRESS
from g2_sbl_writer import (
    DEVICE_RISK_TOKEN,
    FIRMWARE_RISK_TOKEN,
    SblWriteFailure,
    run_stock_update,
)

STOCK = Path(
    "/Users/kalani/Repo/evenRealities-openCFW/g2/blobs/official/"
    "g2-2.2.6.10/ota_s200_firmware_ota.bin"
)


def stock_image(size=1093):
    data = bytearray(size)
    struct.pack_into("<II", data, 32, 0x2007FB00, 0x00438021)
    struct.pack_into("<8I", data, 0, size | (1 << 26), 0, 0, 0, 0xCB, 0x00438000, 0, 0)
    struct.pack_into("<I", data, 4, zlib.crc32(data[8:]) & 0xFFFFFFFF)
    return bytes(data)


def status(max_storage=4096, chip=0x12345678):
    words = [0, (96 << 16) | 1, 0xFFFF0110, max_storage, 0, 2, chip, 0xABCDEF01, 3, 4] + [0] * 14
    frame = bytearray(struct.pack("<24I", *words))
    struct.pack_into("<I", frame, 0, zlib.crc32(frame[4:]) & 0xFFFFFFFF)
    return bytes(frame)


def ack(message_type, ack_status=0, sequence=0):
    frame = bytearray(struct.pack("<5I", 0, (20 << 16) | 7, message_type, ack_status, sequence))
    struct.pack_into("<I", frame, 0, zlib.crc32(frame[4:]) & 0xFFFFFFFF)
    return bytes(frame)


class FixtureTransport:
    def __init__(self, expected_status, *, fail_label=None, nack_label=None,
                 wrong_sequence_label=None):
        self.expected_status = expected_status
        self.fail_label = fail_label
        self.nack_label = nack_label
        self.wrong_sequence_label = wrong_sequence_label
        self.calls = []

    def transact(self, frame, *, timeout, label):
        self.calls.append((label, bytes(frame), timeout))
        if label == self.fail_label:
            raise TimeoutError("fixture timeout")
        if label == "HELLO":
            return self.expected_status
        header, = struct.unpack_from("<I", frame, 4)
        message_type = header & 0xFFFF
        sequence = struct.unpack_from("<I", frame, 8)[0] if message_type == 8 else 0
        if label == self.wrong_sequence_label:
            sequence += 1
        return ack(message_type, 4 if label == self.nack_label else 0, sequence)


class SblWriterTests(unittest.TestCase):
    def run_writer(self, transport, image=None, expected_status=None, **overrides):
        image = image or stock_image()
        expected_status = expected_status or transport.expected_status
        args = dict(
            expected_image_sha256=hashlib.sha256(image).hexdigest(),
            expected_status_frame=expected_status,
            expected_route="left",
            device_risk_token=DEVICE_RISK_TOKEN,
            firmware_risk_token=FIRMWARE_RISK_TOKEN,
        )
        args.update(overrides)
        return run_stock_update(transport, image, **args)

    def test_complete_flow_is_ordered_and_postflight_remains_required(self):
        transport = FixtureTransport(status())
        result = self.run_writer(transport)
        self.assertEqual([row[0].split(":")[0] for row in transport.calls],
                         ["HELLO", "OTADESC", "UPDATE", "DATA", "DATA", "RESET"])
        self.assertEqual(result["firmwareImageBytesAcknowledged"], len(stock_image()))
        self.assertEqual(result["dataFramesAcknowledged"], 2)
        self.assertTrue(result["resetAcknowledged"])
        self.assertFalse(result["glassesRecovered"])
        self.assertEqual(result["outcome"], "reset-acknowledged-postflight-required")
        self.assertEqual(result["retries"], 0)
        descriptor = transport.calls[1][1]
        self.assertEqual(struct.unpack_from("<I", descriptor, 8)[0], G2_OTA_DESCRIPTOR_ADDRESS)

    @unittest.skipUnless(STOCK.exists(), "exact stock input is unavailable")
    def test_exact_stock_image_uses_case_bounded_flow(self):
        image = STOCK.read_bytes()
        transport = FixtureTransport(status(4_000_000))
        result = self.run_writer(transport, image=image)
        self.assertEqual(result["dataFramesPlanned"], 3534)
        self.assertEqual(result["dataFramesAcknowledged"], 3534)
        self.assertEqual(result["firmwareImageBytesAcknowledged"], 3_523_396)
        self.assertEqual(len(transport.calls), 3538)  # HELLO plus 3537 mutating frames.
        self.assertFalse(result["glassesRecovered"])

    def test_authorization_image_status_and_capacity_fail_before_mutation(self):
        image = stock_image()
        for overrides, message in (
            ({"device_risk_token": "wrong"}, "risk tokens"),
            ({"expected_image_sha256": "00" * 32}, "SHA-256"),
        ):
            transport = FixtureTransport(status())
            with self.assertRaisesRegex(SblWriteFailure, message):
                self.run_writer(transport, image=image, **overrides)
            self.assertEqual(transport.calls, [])
        low = FixtureTransport(status(0))
        with self.assertRaisesRegex(SblWriteFailure, "insufficient"):
            self.run_writer(low)
        self.assertEqual(low.calls, [])

    def test_live_status_drift_stops_before_descriptor(self):
        expected = status(chip=1)
        transport = FixtureTransport(status(chip=2))
        with self.assertRaisesRegex(SblWriteFailure, "differs") as caught:
            self.run_writer(transport, expected_status=expected)
        self.assertEqual([row[0] for row in transport.calls], ["HELLO"])
        self.assertEqual(caught.exception.audit["outcome"], "status-identity-drift")

    def test_each_mutating_phase_stops_without_retry(self):
        for label in ("OTADESC", "UPDATE", "DATA:0"):
            transport = FixtureTransport(status(), nack_label=label)
            with self.assertRaises(SblWriteFailure) as caught:
                self.run_writer(transport)
            self.assertEqual(transport.calls[-1][0], label)
            self.assertEqual(sum(row[0] == label for row in transport.calls), 1)
            self.assertEqual(caught.exception.audit["retries"], 0)
            self.assertFalse(caught.exception.audit["resetAttempted"])

    def test_timeout_and_wrong_sequence_are_ambiguous_and_not_replayed(self):
        for transport, expected in (
            (FixtureTransport(status(), fail_label="DATA:0"), "ambiguous"),
            (FixtureTransport(status(), wrong_sequence_label="DATA:0"), "sequence"),
        ):
            with self.assertRaisesRegex(SblWriteFailure, expected) as caught:
                self.run_writer(transport)
            self.assertEqual(sum(row[0] == "DATA:0" for row in transport.calls), 1)
            self.assertEqual(caught.exception.audit["retries"], 0)
            self.assertFalse(caught.exception.audit["resetAttempted"])

    def test_lost_reset_ack_is_ambiguous_and_never_replayed(self):
        transport = FixtureTransport(status(), fail_label="RESET")
        with self.assertRaisesRegex(SblWriteFailure, "ambiguous") as caught:
            self.run_writer(transport)
        self.assertEqual(sum(row[0] == "RESET" for row in transport.calls), 1)
        self.assertTrue(caught.exception.audit["resetAttempted"])
        self.assertFalse(caught.exception.audit["resetAcknowledged"])
        self.assertFalse(caught.exception.audit["glassesRecovered"])


if __name__ == "__main__":
    unittest.main()
