import struct
import unittest
import zlib

from g2_sbl_wire import (
    CASE_BRIDGE_MAX_DATA_BYTES,
    CASE_BRIDGE_MAX_REQUEST_BYTES,
    MAX_DATA_BYTES,
    MSG_DATA,
    MSG_UPDATE,
    data_frame,
    hello_frame,
    image_segments,
    ota_descriptor_frame,
    parse_ack,
    qualify_stock_update,
    reset_frame,
    update_frame,
)


def stock_image(size=96):
    data = bytearray(size)
    struct.pack_into("<II", data, 32, 0x2007FB00, 0x00438021)
    struct.pack_into("<8I", data, 0, size | (1 << 26), 0, 0, 0, 0xCB, 0x00438000, 0, 0)
    struct.pack_into("<I", data, 4, zlib.crc32(data[8:]) & 0xFFFFFFFF)
    return bytes(data)


def status(max_storage):
    words = [0, (96 << 16) | 1, 0xFFFF0110, max_storage, 0, 2, 0x12345678, 0xABCDEF01, 3, 4] + [0] * 14
    frame = bytearray(struct.pack("<24I", *words))
    struct.pack_into("<I", frame, 0, zlib.crc32(frame[4:]) & 0xFFFFFFFF)
    return bytes(frame)


def ack(message_type, ack_status=0, sequence=0):
    frame = bytearray(struct.pack("<5I", 0, (20 << 16) | 7, message_type, ack_status, sequence))
    struct.pack_into("<I", frame, 0, zlib.crc32(frame[4:]) & 0xFFFFFFFF)
    return bytes(frame)


class SblWireTests(unittest.TestCase):
    def test_exact_vendor_command_vectors(self):
        self.assertEqual(hello_frame().hex(), "14559de900000800")
        self.assertEqual(ota_descriptor_frame().hex(), "f6ad805102000c0000e07f00")
        self.assertEqual(update_frame(b"abcdef").hex(), "8c22c2390300140006000000ef398e4b00000000")
        self.assertEqual(data_frame(0, b"\x01\x02\x03").hex(), "77c600a408000f0000000000010203")
        self.assertEqual(reset_frame(1).hex(), "f071336c06000c0001000000")

    def test_data_bounds_and_descriptor_are_fail_closed(self):
        self.assertEqual(CASE_BRIDGE_MAX_REQUEST_BYTES, 1009)
        self.assertEqual(CASE_BRIDGE_MAX_DATA_BYTES, 997)
        self.assertEqual(len(data_frame(0, bytes(CASE_BRIDGE_MAX_DATA_BYTES))), 1009)
        self.assertEqual(len(data_frame(0, bytes(MAX_DATA_BYTES))), 8192)
        for chunk in (b"", bytes(MAX_DATA_BYTES + 1)):
            with self.assertRaises(ValueError):
                data_frame(0, chunk)
        with self.assertRaisesRegex(ValueError, "only the reviewed"):
            ota_descriptor_frame(0x004FE000)
        for option in (0, 3):
            with self.assertRaises(ValueError):
                reset_frame(option)

    def test_ack_crc_type_status_and_sequence_are_all_checked(self):
        parsed = parse_ack(ack(MSG_DATA, sequence=8180), expected_message_type=MSG_DATA, expected_sequence=8180)
        self.assertTrue(parsed["accepted"])
        rejected = parse_ack(ack(MSG_UPDATE, ack_status=4), expected_message_type=MSG_UPDATE)
        self.assertFalse(rejected["accepted"])
        self.assertEqual(rejected["statusName"], "security")
        corrupt = bytearray(ack(MSG_DATA)); corrupt[-1] ^= 1
        with self.assertRaisesRegex(ValueError, "CRC"):
            parse_ack(corrupt, expected_message_type=MSG_DATA)
        with self.assertRaisesRegex(ValueError, "type"):
            parse_ack(ack(MSG_DATA), expected_message_type=MSG_UPDATE)
        with self.assertRaisesRegex(ValueError, "sequence"):
            parse_ack(ack(MSG_DATA, sequence=1), expected_message_type=MSG_DATA)

    def test_segment_parser_is_exact_and_rejects_trailing_bytes(self):
        image = stock_image()
        rows = image_segments(image)
        self.assertEqual([(row["offset"], row["bytes"]) for row in rows], [(0, len(image))])
        self.assertEqual(rows[0]["caseBridgeDataFrames"], 1)
        with self.assertRaisesRegex(ValueError, "truncated"):
            image_segments(image + b"x")
        broken = bytearray(image); struct.pack_into("<I", broken, 0, 0)
        with self.assertRaisesRegex(ValueError, "segment size"):
            image_segments(broken)

    def test_eligibility_requires_real_status_and_never_authorizes_write(self):
        image = stock_image()
        import hashlib
        digest = hashlib.sha256(image).hexdigest()
        report = qualify_stock_update(image, status(0), expected_sha256=digest)
        self.assertTrue(report["framingValidated"])
        self.assertTrue(report["capacityAccepted"])
        self.assertFalse(report["firmwareWriteAuthorized"])
        self.assertFalse(report["transportExecutionImplemented"])
        self.assertIsNone(report["retailPolicyAccepted"])
        self.assertEqual(report["otaDescriptorAddress"], "0x007fe000")
        with self.assertRaisesRegex(ValueError, "STATUS"):
            qualify_stock_update(image, bytes(96), expected_sha256=digest)


if __name__ == "__main__":
    unittest.main()
