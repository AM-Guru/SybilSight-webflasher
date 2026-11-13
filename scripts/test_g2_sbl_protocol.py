import struct
import unittest
import zlib

from g2_sbl_protocol import (
    HELLO,
    classify_capture,
    find_status_frames,
    parse_ready_frame,
)
from g2_sbl_image import parse_apollo_standard_image


def status(version=0xffff0110):
    words = [0, (96 << 16) | 1, version, 0x40000, 0, 2, 0x12345678, 0xabcdef01, 3, 4] + [0] * 14
    frame = bytearray(struct.pack("<24I", *words))
    struct.pack_into("<I", frame, 0, zlib.crc32(frame[4:]) & 0xffffffff)
    return bytes(frame)


def apollo_main(*, crc=True, magic=0xCB, load=0x00438000, reset=0x00438021):
    body = bytearray(32 + 64)
    struct.pack_into("<II", body, 32, 0x2007FB00, reset)
    control = len(body) | ((1 << 26) if crc else 0)
    struct.pack_into("<8I", body, 0, control, 0, 0, 0, magic, load, 0, 0)
    if crc:
        struct.pack_into("<I", body, 4, zlib.crc32(body[8:]) & 0xFFFFFFFF)
    return bytes(body)


class SblProtocolTests(unittest.TestCase):
    def test_apollo_standard_image_candidate_is_integrity_not_authorization(self):
        image = apollo_main()
        parsed = parse_apollo_standard_image(image)
        self.assertTrue(parsed["crcValidated"])
        self.assertTrue(parsed["vectorValidated"])
        self.assertTrue(parsed["g2StockMainEnvelopeCandidate"])
        self.assertFalse(parsed["authenticationRequested"])
        self.assertFalse(parsed["encryptionRequested"])
        self.assertFalse(parsed["firmwareWriteAuthorized"])
        self.assertIsNone(parsed["retailPolicyAccepted"])

    def test_apollo_standard_image_rejects_integrity_identity_and_vector_drift(self):
        image = apollo_main()
        corrupt = bytearray(image)
        corrupt[-1] ^= 1
        with self.assertRaisesRegex(ValueError, "CRC differs"):
            parse_apollo_standard_image(bytes(corrupt))
        with self.assertRaisesRegex(ValueError, "SHA-256 differs"):
            parse_apollo_standard_image(image, expected_sha256="00" * 32)
        with self.assertRaisesRegex(ValueError, "embedded size differs"):
            parse_apollo_standard_image(struct.pack("<I", len(image) - 1 | (1 << 26)) + image[4:])
        with self.assertRaisesRegex(ValueError, "vector table"):
            parse_apollo_standard_image(apollo_main(reset=0x00420001))

    def test_apollo_non_crc_image_is_never_recovery_candidate(self):
        parsed = parse_apollo_standard_image(apollo_main(crc=False))
        self.assertFalse(parsed["crcValidated"])
        self.assertFalse(parsed["g2StockMainEnvelopeCandidate"])

    def test_exact_vendor_hello(self):
        self.assertEqual(struct.unpack("<II", HELLO), (zlib.crc32(HELLO[4:]), 8 << 16))

    def test_status_survives_echo_noise_and_zero_values(self):
        noise = HELLO * 3 + b"\x14\x08\x00\x5a\xa5\xff"
        decoded = find_status_frames(noise + status())
        self.assertEqual(len(decoded), 1)
        self.assertEqual(decoded[0]["offset"], len(noise))
        self.assertEqual(decoded[0]["sblVersion"], "1.16")
        self.assertEqual(decoded[0]["chipId"], ["12345678", "abcdef01"])
        self.assertFalse(decoded[0]["firmwareWriteAuthorized"])

    def test_crc_corruption_rejected_at_every_byte(self):
        for index in range(96):
            frame = bytearray(status())
            frame[index] ^= 1
            self.assertEqual(find_status_frames(frame), [], index)

    def test_resynchronizes_after_bad_and_oversized_headers(self):
        bad = bytearray(status()); bad[0] ^= 1
        noise = bytes(bad) + struct.pack("<II", 0, (65535 << 16) | 1)
        self.assertEqual(find_status_frames(noise + status())[0]["offset"], len(noise))

    def test_all_truncations_are_incomplete(self):
        for count in range(96):
            self.assertEqual(find_status_frames(status()[:count]), [], count)

    def test_hello_echo_alone_is_never_success(self):
        self.assertEqual(find_status_frames(HELLO * 100), [])

    def test_legacy_security_debug_layout(self):
        decoded = find_status_frames(status(0xffff0100))[0]
        self.assertIsNone(decoded["chipRevision"])
        self.assertEqual(decoded["securityDebugCertificate"], 4)

    def test_silence_does_not_prove_recovery_unavailable(self):
        report = classify_capture(b"", reset_evidence="operator-reported-depleted-insertion")
        self.assertFalse(report["physicalResetVerified"])
        self.assertEqual(report["state"], "no-valid-sbl-status-captured")
        self.assertFalse(report["firmwareWriteAuthorized"])

    def test_multiple_status_frames_and_capture_bound(self):
        self.assertEqual(len(find_status_frames(status() + HELLO + status())), 2)
        with self.assertRaises(ValueError):
            find_status_frames(bytes(1_048_577))

    def test_post_routing_readiness_requires_exact_configuration_and_crc(self):
        manifest = {"route":"right","profile":"observed-33-entry1","nominalBaud":1000000,"attempts":4000,"receiveIntervalMs":20}
        body = struct.pack("<5I",0x42533247,0x20101,64,4000,20)
        frame = body + struct.pack("<I",zlib.crc32(body) & 0xffffffff)
        self.assertEqual(parse_ready_frame(frame,manifest)["route"],"right")
        for index in range(24):
            corrupt=bytearray(frame); corrupt[index]^=1
            with self.assertRaises(ValueError): parse_ready_frame(corrupt,manifest)
        with self.assertRaises(ValueError): parse_ready_frame(frame,{**manifest,"route":"left"})
        with self.assertRaises(ValueError): parse_ready_frame(frame[:23],manifest)


if __name__ == "__main__":
    unittest.main()
