#!/usr/bin/env python3
"""Offline tests for the direct-UART and case-USB G2 flash tooling."""

from __future__ import annotations

import json
import struct
import sys
import tempfile
import unittest
import zlib
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from g2_case_pogo_flasher import (  # noqa: E402
    ALLOWED_YHM_BASELINES,
    BRIDGE_BYTES,
    BRIDGE_SHA256,
    CFW_2_2_9_CANDIDATE_MAIN_BYTES,
    CFW_2_2_9_CANDIDATE_MAIN_SHA256,
    CFW_2_2_9_CANDIDATE_SHA256,
    FINAL_RESET_COMMAND,
    FLASH_HOST_HEADER_BYTE_INTERVAL_SECONDS,
    FLASH_RESPONSE_SCAN_LIMIT,
    OBSERVED_CHARGING_BRIDGE_SHA256,
    OPENCFW_2_2_6_RELEASE_MAIN_BYTES,
    OPENCFW_2_2_6_RELEASE_MAIN_SHA256,
    OPENCFW_2_2_6_RELEASE_SHA256,
    OPENCFW_2_2_6_RELEASE_VERSION,
    PACING_PROFILES,
    RECENT_RESET_PROOF_MAX_AGE_SECONDS,
    REVIEWED_CFW_SHA256,
    REVIEWED_OFFICIAL_MAIN_BYTES,
    REVIEWED_OFFICIAL_MAIN_SHA256,
    REVIEWED_OFFICIAL_SHA256,
    ROUTE_PHASE_SETTLE_SECONDS,
    SBL_CAPTURE_BYTES,
    SBL_HELLO_PROBE_BRIDGE_SHA256,
    SBL_HELLO_PROBE_CHARGING_BRIDGE_SHA256,
    SBL_HELLO_REQUEST,
    _write_audit,
    build_parser,
    build_bridge,
    build_sbl_hello_probe_bridge,
    can_run_final_reset_after_failure,
    classify_zero_byte_start_boundary,
    load_recent_reset_proof,
    parse_case_restore_evidence,
    parse_sbl_status_response,
    reset_both_temples_and_recheck,
    reset_for_sbl_hello_window,
    resolve_pacing_profile,
    verify_route_stability,
)
from build_g2flash_cfw_2_2_9 import (  # noqa: E402
    CAPABILITY_MARKER,
    protobuf_varint,
)
import g2_case_pogo_flasher as case_flasher  # noqa: E402
import g2_case_rom as case_rom  # noqa: E402
from g2_pogo_flasher import (  # noqa: E402
    DeviceRejected,
    MainFirmwareFlasher,
    NonIdempotentOtaError,
    ProtocolError,
    SafetyError,
    TransportTimeout,
    build_package_plan,
    decode_version_response,
    require_ota_ack,
    validate_main_component,
)
from g2_pogo_protocol import (  # noqa: E402
    Component,
    build_response,
    crc32c_msb,
    self_test as protocol_self_test,
)


KNOWN_VERSION_FRAME = bytes.fromhex("5aa5ff09240103050202060a054d")
TYPE_ORDER = (4, 5, 3, 6, 1, 0)
NAME_ORDER = (
    "firmware/codec.bin",
    "firmware/ble_em9305.bin",
    "firmware/touch.bin",
    "firmware/box.bin",
    "ota/s200_bootloader.bin",
    "ota/s200_firmware_ota.bin",
)


def make_main_component(payload_size: int = 2_500) -> Component:
    payload = bytearray(payload_size)
    struct.pack_into("<I", payload, 0, 0x04000000 | payload_size)
    struct.pack_into("<I", payload, 0x10, 0xCB)
    struct.pack_into("<I", payload, 0x14, 0x00438000)
    struct.pack_into("<I", payload, 0x20, 0x20010000)
    struct.pack_into("<I", payload, 0x24, 0x00438041)
    struct.pack_into("<I", payload, 4, zlib.crc32(payload[8:]))

    header = bytearray(128)
    struct.pack_into("<I", header, 8, payload_size)
    struct.pack_into("<I", header, 12, crc32c_msb(payload))
    struct.pack_into("<I", header, 0x24, 0)
    struct.pack_into("<I", header, 0x28, 3)
    header[0x30 : 0x30 + len(NAME_ORDER[-1])] = NAME_ORDER[-1].encode()
    return Component(
        index=6,
        entry_id=6,
        type_id=0,
        storage_type=3,
        filename=NAME_ORDER[-1],
        header=bytes(header),
        payload=bytes(payload),
    )


def make_synthetic_bundle() -> bytes:
    components: list[Component] = []
    for index, (type_id, name) in enumerate(zip(TYPE_ORDER, NAME_ORDER), 1):
        if type_id == 0:
            components.append(make_main_component())
            continue
        payload = bytes((index, type_id, 0xA5, 0x5A))
        header = bytearray(128)
        struct.pack_into("<I", header, 8, len(payload))
        struct.pack_into("<I", header, 12, crc32c_msb(payload))
        struct.pack_into("<I", header, 0x24, type_id)
        struct.pack_into("<I", header, 0x28, 3)
        header[0x30 : 0x30 + len(name)] = name.encode()
        components.append(
            Component(
                index=index,
                entry_id=index,
                type_id=type_id,
                storage_type=3,
                filename=name,
                header=bytes(header),
                payload=payload,
            )
        )

    table_end = 0x40 + len(components) * 0x10
    first_offset = table_end + 16
    image_size = first_offset + sum(128 + len(item.payload) for item in components)
    image = bytearray(image_size)
    image[:8] = b"EVENOTA\0"
    struct.pack_into("<I", image, 8, len(components))
    image[0x10:0x1A] = b"2026-07-25"
    image[0x20:0x28] = b"12:00:00"
    image[0x30:0x3F] = b"s200_v2.2.6.10"
    image[table_end:first_offset] = b"evenota\0" + bytes(8)

    offset = first_offset
    for index, component in enumerate(components):
        size = 128 + len(component.payload)
        checksum = crc32c_msb(component.payload)
        struct.pack_into(
            "<IIII",
            image,
            0x40 + index * 0x10,
            component.entry_id,
            offset,
            size,
            checksum,
        )
        image[offset : offset + 128] = component.header
        image[offset + 128 : offset + size] = component.payload
        offset += size
    return bytes(image)


class FakeTransport:
    def __init__(
        self,
        *,
        timeout_once_sequence: int | None = None,
        reject_once_sequence: int | None = None,
        finish_timeout: bool = False,
    ) -> None:
        self.requests: list[bytes] = []
        self.timeout_once_sequence = timeout_once_sequence
        self.reject_once_sequence = reject_once_sequence
        self.finish_timeout = finish_timeout
        self.timed_out = False
        self.rejected = False

    def transact(self, request: bytes, timeout: float) -> bytes:
        del timeout
        self.requests.append(request)
        if request[0] == 0x55 and self.finish_timeout:
            raise TransportTimeout("synthetic missing finish reply")
        if (
            request[0] == 0x54
            and request[6] == self.timeout_once_sequence
            and not self.timed_out
        ):
            self.timed_out = True
            raise TransportTimeout("synthetic lost data reply")
        if (
            request[0] == 0x54
            and request[6] == self.reject_once_sequence
            and not self.rejected
        ):
            self.rejected = True
            return build_response(0x54, 1)
        if request[0] == 0x24:
            return KNOWN_VERSION_FRAME
        return build_response(request[0], 0)

    def drain_input(self) -> None:
        return None

    def close(self) -> None:
        return None


class CaseRomRetryTests(unittest.TestCase):
    def test_short_read_reenters_rom_and_retries_exact_address(self) -> None:
        expected = bytes([0xA5]) * 128
        port = object()
        with (
            patch.object(
                case_rom,
                "_read_memory_once",
                side_effect=[
                    case_rom.BootloaderError("got 31 of 128 bytes"),
                    expected,
                ],
            ) as read_once,
            patch.object(
                case_rom,
                "_resynchronize_rom_loader",
            ) as resynchronize,
        ):
            actual = case_rom.read_memory(port, 0x1FFF7800, 128)

        self.assertEqual(actual, expected)
        self.assertEqual(read_once.call_count, 2)
        read_once.assert_called_with(port, 0x1FFF7800, 128)
        resynchronize.assert_called_once_with(port)


class G2FlashToolTests(unittest.TestCase):
    class FakeCasePort:
        def __init__(self) -> None:
            self.closed = False
            self.writes: list[bytes] = []

        def reset_input_buffer(self) -> None:
            return None

        def write(self, data: bytes) -> int:
            self.writes.append(data)
            return len(data)

        def flush(self) -> None:
            return None

        def close(self) -> None:
            self.closed = True

    class BufferedCasePort:
        def __init__(self, data: bytes) -> None:
            self.data = bytearray(data)
            self.timeout = 0.0

        def read(self, count: int) -> bytes:
            result = bytes(self.data[:count])
            del self.data[:count]
            return result

    @staticmethod
    def bridge_response(sequence: int, captured: bytes = b"") -> bytes:
        header = b"G2RX" + bytes((1, sequence, 0, 0, len(captured), 0, 0))
        body = header + captured
        return body + bytes((sum(body) & 0xFF,))

    def test_protocol_vectors(self) -> None:
        protocol_self_test()

    def test_embedded_case_bridge_is_pinned(self) -> None:
        payload = build_bridge()
        self.assertEqual(len(payload), BRIDGE_BYTES)
        import hashlib

        self.assertEqual(hashlib.sha256(payload).hexdigest(), BRIDGE_SHA256)
        self.assertEqual(struct.unpack_from("<II", payload), (0x2001F000, 0x20010009))

        charging_payload = build_bridge(observed_charging_phase=True)
        self.assertEqual(len(charging_payload), BRIDGE_BYTES)
        self.assertEqual(
            hashlib.sha256(charging_payload).hexdigest(),
            OBSERVED_CHARGING_BRIDGE_SHA256,
        )
        self.assertEqual(
            sum(
                charging_payload[offset] == 0x33
                and charging_payload[offset + 1] == 0xFF
                for offset in (2826, 2836, 2846, 2856)
            ),
            4,
        )

    def test_sbl_hello_probe_bridge_and_request_are_exactly_pinned(self) -> None:
        import hashlib

        self.assertEqual(SBL_HELLO_REQUEST.hex(), "14559de900000800")
        self.assertEqual(SBL_CAPTURE_BYTES, 128)
        payload = build_sbl_hello_probe_bridge()
        self.assertEqual(len(payload), BRIDGE_BYTES)
        self.assertEqual(
            hashlib.sha256(payload).hexdigest(),
            SBL_HELLO_PROBE_BRIDGE_SHA256,
        )
        self.assertEqual(payload[0x3A0:0x3A8], SBL_HELLO_REQUEST)
        self.assertEqual(payload[0x396:0x398], bytes.fromhex("0020"))
        self.assertEqual(payload[0x39A:0x39C], bytes.fromhex("0120"))
        self.assertEqual(payload[0x2B8:0x2BA], bytes.fromhex("8021"))
        self.assertEqual(payload[0x5D4:0x5DA], bytes.fromhex("802e00d98026"))

        charging_payload = build_sbl_hello_probe_bridge(
            observed_charging_phase=True
        )
        self.assertEqual(
            hashlib.sha256(charging_payload).hexdigest(),
            SBL_HELLO_PROBE_CHARGING_BRIDGE_SHA256,
        )

    def test_sbl_status_response_requires_complete_crc_valid_status(self) -> None:
        body = struct.pack("<IIIII", (24 << 16) | 1, 3, 0x4FFA0, 2, 7)
        frame = struct.pack("<I", zlib.crc32(body) & 0xFFFFFFFF) + body
        parsed = parse_sbl_status_response(frame)
        self.assertEqual(parsed["message_type"], 1)
        self.assertEqual(parsed["declared_length"], 24)
        self.assertEqual(parsed["protocol_version"], 3)
        self.assertEqual(parsed["max_storage"], 0x4FFA0)
        self.assertEqual(parsed["status"], 2)
        self.assertEqual(parsed["state"], 7)
        with self.assertRaisesRegex(ProtocolError, "CRC mismatch"):
            parse_sbl_status_response(bytes((frame[0] ^ 1,)) + frame[1:])
        with self.assertRaisesRegex(ProtocolError, "truncated"):
            parse_sbl_status_response(frame[:-1])

    def test_sbl_probe_cli_is_right_only_and_explicit(self) -> None:
        args = build_parser().parse_args([
            "probe-apollo-sbl-right",
            "--device",
            "/dev/null",
            "--glasses-seated-confirmed",
            "--execute-bounded-reset-and-hello",
            "--log",
            "audit.json",
        ])
        self.assertEqual(args.command, "probe-apollo-sbl-right")
        self.assertTrue(args.execute_bounded_reset_and_hello)
        self.assertFalse(hasattr(args, "route"))

    def test_sbl_zero_write_setup_stop_is_verified_without_allowlisting(self) -> None:
        result = bytearray(128)
        words = {
            0: 0x57463247,
            1: 3,
            2: 1,
            3: 0x42,
            4: 3,
            5: 0x3FF,
        }
        for index, value in words.items():
            struct.pack_into("<I", result, index * 4, value)
        baseline = bytes.fromhex("810104ffa603c10522ff")
        result[64:74] = baseline

        class FakeRomPort:
            is_open = True

            def close(self) -> None:
                self.is_open = False

        port = FakeRomPort()
        transport = case_flasher.CaseSramTempleTransport.__new__(
            case_flasher.CaseSramTempleTransport
        )
        transport.device = "/dev/fake"
        transport.route = "right"
        transport.sequence = 0
        transport.sbl_hello_probe = True
        transport.completed_transfer = None
        transport.retained_result = {}
        transport.restore_verified = False
        transport.baseline = b""
        transport.restored = b""

        reads = iter((case_flasher.PROOF, bytes(result), bytes(8), bytes(128)))
        with (
            patch.object(case_flasher, "open_rom_loader", return_value=port),
            patch.object(case_flasher, "require_expected_identity"),
            patch.object(case_flasher, "read_memory", side_effect=lambda *args: next(reads)),
            patch.object(transport, "_write_sram"),
        ):
            transport._verify_retained_restore()

        self.assertTrue(transport.restore_verified)
        self.assertEqual(transport.baseline, baseline)
        self.assertEqual(transport.restored, bytes(10))
        self.assertTrue(
            transport.retained_result["zero_write_setup_stop_verified"]
        )

    def test_sbl_reset_preflight_and_deb0_share_one_case_session(self) -> None:
        class ProbePort(self.FakeCasePort):
            def __init__(self) -> None:
                super().__init__()
                self.response = bytearray(
                    b"reset gls L & R, reason: cmd\r\n"
                )

            def read(self, count: int) -> bytes:
                result = bytes(self.response[:count])
                del self.response[:count]
                return result

        port = ProbePort()
        banner = b"****** B200 1.2.57 ABC******\r\n"
        presence = (
            b"****** B200 vol:4166 pct:100, open:1, usb:1, cur:-19, "
            b"GLS_L:1, GLS_R:1 temp:350\r\n"
        )
        with (
            patch.object(case_flasher, "_open_case_console", return_value=port) as opened,
            patch.object(
                case_flasher,
                "_drain_case_console",
                side_effect=(banner, presence),
            ),
        ):
            report = reset_for_sbl_hello_window("/dev/fake")

        opened.assert_called_once_with("/dev/fake")
        self.assertEqual(port.writes, [b"DEA3\n", FINAL_RESET_COMMAND])
        self.assertTrue(port.closed)
        self.assertTrue(report["right_present"])
        self.assertTrue(report["reset_confirmed"])

    def test_audit_checkpoints_are_private_and_atomic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "flash-audit.json"
            _write_audit(path, {"outcome": "started"})
            self.assertEqual(path.read_text(encoding="utf-8"), '{\n  "outcome": "started"\n}\n')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertFalse(path.with_suffix(".json.partial").exists())

    def test_official_restore_command_is_distinct_and_available(self) -> None:
        self.assertNotEqual(REVIEWED_OFFICIAL_SHA256, REVIEWED_CFW_SHA256)
        self.assertEqual(REVIEWED_OFFICIAL_MAIN_BYTES, 3_523_396)
        self.assertEqual(len(REVIEWED_OFFICIAL_MAIN_SHA256), 64)
        args = build_parser().parse_args([
            "flash-reviewed-official",
            "stock.bin",
            "--device",
            "/dev/null",
            "--routes",
            "right",
            "--confirm-image-sha256",
            REVIEWED_OFFICIAL_SHA256,
            "--log",
            "audit.json",
        ])
        self.assertEqual(args.command, "flash-reviewed-official")
        self.assertEqual(args.routes, "right")
        self.assertEqual(args.pacing_profile, "conservative")

    def test_2_2_9_candidate_command_and_observed_idle_phase_are_pinned(self) -> None:
        self.assertEqual(CFW_2_2_9_CANDIDATE_MAIN_BYTES, 3_731_795)
        self.assertEqual(len(CFW_2_2_9_CANDIDATE_MAIN_SHA256), 64)
        self.assertEqual(len(CAPABILITY_MARKER.encode("ascii")), 182)
        self.assertEqual(protobuf_varint(127), b"\x7f")
        self.assertEqual(protobuf_varint(128), b"\x80\x01")
        self.assertEqual(protobuf_varint(162), b"\xa2\x01")
        self.assertEqual(protobuf_varint(182), b"\xb6\x01")
        self.assertIn(
            bytes.fromhex("811104afaf03812033ff"),
            ALLOWED_YHM_BASELINES,
        )
        args = build_parser().parse_args([
            "flash-candidate-cfw-2.2.9.28",
            "candidate.bin",
            "--device",
            "/dev/null",
            "--confirm-image-sha256",
            CFW_2_2_9_CANDIDATE_SHA256,
            "--log",
            "audit.json",
        ])
        self.assertEqual(args.command, "flash-candidate-cfw-2.2.9.28")
        self.assertEqual(args.routes, "both")
        self.assertEqual(ROUTE_PHASE_SETTLE_SECONDS, (45.0, 90.0, 180.0))

    def test_opencfw_2_2_6_release_command_is_exactly_pinned(self) -> None:
        self.assertEqual(OPENCFW_2_2_6_RELEASE_MAIN_BYTES, 3_714_962)
        self.assertEqual(len(OPENCFW_2_2_6_RELEASE_MAIN_SHA256), 64)
        self.assertEqual(len(OPENCFW_2_2_6_RELEASE_SHA256), 64)
        self.assertEqual(OPENCFW_2_2_6_RELEASE_VERSION, "2.2.6.0")
        args = build_parser().parse_args([
            "flash-opencfw-2.2.6.0",
            "open-cfw.bin",
            "--device",
            "/dev/null",
            "--routes",
            "left",
            "--confirm-image-sha256",
            OPENCFW_2_2_6_RELEASE_SHA256,
            "--log",
            "audit.json",
        ])
        self.assertEqual(args.command, "flash-opencfw-2.2.6.0")
        self.assertEqual(args.routes, "left")
        self.assertEqual(args.pacing_profile, "conservative")

    def test_unqualified_pacing_profile_requires_explicit_risk_acceptance(self) -> None:
        with self.assertRaisesRegex(ValueError, "not hardware-qualified"):
            resolve_pacing_profile(
                "balanced-lab",
                accept_experimental_risk=False,
            )
        profile = resolve_pacing_profile(
            "balanced-lab",
            accept_experimental_risk=True,
        )
        self.assertEqual(profile["deferred_batch_size"], 12_000)
        self.assertFalse(profile["hardware_qualified"])
        self.assertTrue(PACING_PROFILES["conservative"]["hardware_qualified"])
        retry_profile = resolve_pacing_profile(
            "conservative-retry",
            accept_experimental_risk=False,
        )
        self.assertEqual(retry_profile["deferred_batch_size"], 6_000)
        self.assertEqual(retry_profile["batch_settle_seconds"], 2.0)
        self.assertEqual(retry_profile["late_batch_settle_seconds"], 4.0)
        self.assertEqual(retry_profile["final_settle_seconds"], 30.0)
        self.assertTrue(retry_profile["hardware_qualified"])

    def test_reset_only_command_is_bilateral_and_hardware_gated(self) -> None:
        args = build_parser().parse_args([
            "reset-both-temples",
            "--device",
            "/dev/null",
            "--glasses-seated-confirmed",
        ])
        self.assertEqual(args.command, "reset-both-temples")
        self.assertEqual(args.expect_version, "2.2.6.10")

    def test_recent_bilateral_reset_proof_is_device_version_and_time_gated(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "reset-proof.json"
            proof = {
                "schema_version": 1,
                "operation": "g2_case_usb_bilateral_reset_proof",
                "created_at_utc": datetime.now(timezone.utc).isoformat(),
                "device": "/dev/cu.authorized-case",
                "report": {
                    "outcome": "success",
                    "case": {
                        "case_version": "1.2.57",
                        "reset_confirmed": True,
                        "left_present": True,
                        "right_present": True,
                    },
                    "versions": {
                        "left": {"firmware": "2.2.6.10", "hardware": 5},
                        "right": {"firmware": "2.2.6.10", "hardware": 5},
                    },
                },
            }
            path.write_text(json.dumps(proof), encoding="utf-8")
            loaded = load_recent_reset_proof(
                path,
                device="/dev/cu.authorized-case",
                accepted_versions={"2.2.6.10"},
            )
            self.assertLessEqual(
                loaded["validated_age_seconds"],
                RECENT_RESET_PROOF_MAX_AGE_SECONDS,
            )
            with self.assertRaisesRegex(SafetyError, "different USB device"):
                load_recent_reset_proof(
                    path,
                    device="/dev/cu.other-case",
                    accepted_versions={"2.2.6.10"},
                )

    def test_final_reset_requires_b0_confirmation_and_contacts(self) -> None:
        report = parse_case_restore_evidence(
            b"****** B200 1.2.57 ABC******\r\n"
            b"reset gls L & R, reason: cmd\r\n"
            b"****** B200 vol:4166 pct:100, open:1, usb:1, cur:-19, "
            b"GLS_L:1, GLS_R:1 temp:350, chEn:1, aging:0, otaGls:0\r\n",
            require_reset_confirmation=True,
        )
        self.assertEqual(FINAL_RESET_COMMAND, b"DEB0\n")
        self.assertTrue(report["reset_confirmed"])
        self.assertTrue(report["left_present"])
        self.assertTrue(report["right_present"])

    def test_final_reset_evidence_rejects_missing_confirmation(self) -> None:
        with self.assertRaises(SafetyError):
            parse_case_restore_evidence(
                b"****** B200 1.2.57 ABC******\r\n"
                b"****** B200 vol:4166 pct:100, open:1, usb:1, cur:-19, "
                b"GLS_L:1, GLS_R:1 temp:350, chEn:1, aging:0, otaGls:0\r\n",
                require_reset_confirmation=True,
            )

    def test_case_presence_accepts_a3_telemetry_without_a4_ota_field(self) -> None:
        report = parse_case_restore_evidence(
            b"****** B200 1.2.57 ABC******\r\n"
            b"****** B200 vol:4166 pct:100, open:1, usb:1, cur:-19, "
            b"GLS_L:1, GLS_R:1 temp:350\r\n",
            require_reset_confirmation=False,
        )
        self.assertTrue(report["left_present"])
        self.assertTrue(report["right_present"])
        self.assertIsNone(report["ota_glasses"])

    def test_read_only_stability_helper_remains_single_query(self) -> None:
        self.assertEqual(case_flasher.FLASH_STABILITY_QUERIES, 1)

        class FakeFlasher:
            def __init__(self) -> None:
                self.queries = 0

            def read_version(self):
                self.queries += 1
                return type(
                    "Version",
                    (),
                    {"firmware": "2.2.6.10", "hardware": 5},
                )()

        flasher = FakeFlasher()
        sleeps: list[float] = []
        report = verify_route_stability(
            flasher,
            "2.2.6.10",
            5,
            queries=4,
            interval_seconds=0.025,
            sleeper=sleeps.append,
        )
        self.assertEqual(flasher.queries, 3)
        self.assertEqual(sleeps, [0.025, 0.025, 0.025])
        self.assertEqual(report["outcome"], "success")
        flasher.queries = 0
        sleeps.clear()
        report = verify_route_stability(
            flasher,
            "2.2.6.10",
            5,
            queries=1,
            interval_seconds=0.025,
            sleeper=sleeps.append,
        )
        self.assertEqual(flasher.queries, 0)
        self.assertEqual(sleeps, [])
        self.assertEqual(report["queries"], 1)

    def test_case_bridge_transaction_header_is_split_after_idle(self) -> None:
        transport = case_flasher.CaseSramTempleTransport.__new__(
            case_flasher.CaseSramTempleTransport
        )

        class FakePort:
            def __init__(self) -> None:
                self.writes: list[bytes] = []

            def write(self, data: bytes) -> int:
                self.writes.append(data)
                return len(data)

            def flush(self) -> None:
                return None

        transport.port = FakePort()
        header = bytes(range(10))
        with patch.object(case_flasher.time, "sleep") as sleep:
            transport._write_host_header(header)
        self.assertEqual(transport.port.writes, [bytes((byte,)) for byte in header])
        self.assertEqual(sleep.call_count, 9)
        sleep.assert_called_with(FLASH_HOST_HEADER_BYTE_INTERVAL_SECONDS)

    def test_case_bridge_response_scanner_skips_short_and_stale_candidates(self) -> None:
        transport = case_flasher.CaseSramTempleTransport.__new__(
            case_flasher.CaseSramTempleTransport
        )
        transport.sequence = 7
        short = b"G2RX\x01\x07"
        stale = self.bridge_response(6, b"stale")
        expected = self.bridge_response(7, b"fresh")
        transport.port = self.BufferedCasePort(b"junk" + short + stale + expected)
        status, errors, captured = transport._read_response(1.0)
        self.assertEqual((status, errors, captured), (0, 0, b"fresh"))
        self.assertEqual(FLASH_RESPONSE_SCAN_LIMIT, 256)

    def test_header_token_reader_discards_late_checksum_valid_cached_frame(self) -> None:
        transport = case_flasher.CaseSramTempleTransport.__new__(
            case_flasher.CaseSramTempleTransport
        )
        cached = self.bridge_response(1, bytes.fromhex("5aa5ff00ff"))
        transport.port = self.BufferedCasePort(cached + b"\xc3")
        transport._read_header_flow_token(case_flasher.time.monotonic() + 1.0)
        self.assertEqual(transport.port.data, b"")

    def test_final_reset_reopens_console_before_fresh_telemetry(self) -> None:
        reset_port = self.FakeCasePort()
        incomplete_port = self.FakeCasePort()
        telemetry_port = self.FakeCasePort()
        ports = [reset_port, incomplete_port, telemetry_port]
        outputs = {
            id(reset_port): iter([
                b"****** B200 1.2.57 ABC******\r\n",
                b"reset gls L & R, reason: cmd\r\n",
            ]),
            id(incomplete_port): iter([
                b"****** B200 1.2.57 ABC******\r\n",
                b"B200 1.2.57, 3\r\n",
                b"post-reset links still starting\r\n",
            ]),
            id(telemetry_port): iter([
                b"****** B200 1.2.57 ABC******\r\n",
                b"B200 1.2.57, 3\r\n",
                b"****** B200 vol:4155 pct:100, open:1, usb:1, cur:-9, "
                b"GLS_L:1, GLS_R:1 temp:265, chEn:1, aging:0, otaGls:0\r\n",
            ]),
        }
        open_count = 0

        def open_console(_: str) -> G2FlashToolTests.FakeCasePort:
            nonlocal open_count
            if open_count:
                self.assertTrue(
                    ports[open_count - 1].closed,
                    "each reset/telemetry console must close before the next",
                )
            port = ports[open_count]
            open_count += 1
            return port

        def drain(port: G2FlashToolTests.FakeCasePort, _: float) -> bytes:
            return next(outputs[id(port)])

        with (
            patch.object(case_flasher, "_open_case_console", open_console),
            patch.object(case_flasher, "_drain_case_console", drain),
            patch.object(case_flasher.time, "sleep"),
        ):
            report = reset_both_temples_and_recheck("/dev/fake")

        self.assertEqual(reset_port.writes, [FINAL_RESET_COMMAND])
        self.assertEqual(incomplete_port.writes, [b"DEA0\n", b"DEA3\n"])
        self.assertEqual(telemetry_port.writes, [b"DEA0\n", b"DEA3\n"])
        self.assertTrue(telemetry_port.closed)
        self.assertTrue(report["reset_confirmed"])
        self.assertEqual(report["post_reset_telemetry_session"], "reopened")
        self.assertEqual(report["post_reset_telemetry_attempt"], 2)
        self.assertTrue(report["left_present"])
        self.assertTrue(report["right_present"])

    def test_failure_reset_requires_verified_cleanup_on_every_attempt(self) -> None:
        verified = {
            "case_restore_verified": True,
            "case_application_version": "1.2.57",
        }
        self.assertTrue(can_run_final_reset_after_failure([verified]))
        self.assertFalse(can_run_final_reset_after_failure([]))
        self.assertFalse(
            can_run_final_reset_after_failure([
                verified,
                {
                    "case_restore_verified": False,
                    "case_application_version": "1.2.57",
                },
            ])
        )

    def test_zero_byte_start_boundary_routes_to_fresh_ble(self) -> None:
        error = NonIdempotentOtaError(
            "START",
            0x52,
            TransportTimeout("no complete temple frame through case bridge"),
        )
        result = classify_zero_byte_start_boundary(
            error,
            {
                "declared_size": 0,
                "accepted_size": 0,
                "temple_tx_count": 2,
            },
        )
        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(
            result["classification"],
            "wired_start_no_frame_zero_byte_boundary",
        )
        self.assertEqual(result["firmware_bytes_accepted"], 0)
        self.assertIn("fresh BLE", result["recommended_next_transport"])

    def test_start_timeout_is_classified_and_never_replayed(self) -> None:
        class StartTimeoutTransport(FakeTransport):
            def transact(self, request: bytes, timeout: float) -> bytes:
                self.requests.append(request)
                if request[0] == 0x52:
                    raise TransportTimeout("no complete temple frame")
                return super().transact(request, timeout)

        transport = StartTimeoutTransport()
        with self.assertRaises(NonIdempotentOtaError) as caught:
            MainFirmwareFlasher(transport).flash_main(make_main_component())
        self.assertEqual(caught.exception.stage, "START")
        self.assertEqual(caught.exception.command, 0x52)
        self.assertIn("fresh BLE connection", str(caught.exception))
        self.assertEqual(
            [request[0] for request in transport.requests],
            [0x52],
        )

    def test_portable_synthetic_package_plan(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "synthetic.bin"
            image.write_bytes(make_synthetic_bundle())
            plan, main = build_package_plan(image)
        self.assertEqual(plan.expected_device_version, "2.2.6.10")
        self.assertEqual(plan.main_payload_bytes, 2_500)
        self.assertEqual(plan.main_record_count, 3)
        self.assertEqual(validate_main_component(main)[0], 2_468)

    def test_version_and_ack_validation(self) -> None:
        version = decode_version_response(KNOWN_VERSION_FRAME)
        self.assertEqual((version.firmware, version.hardware), ("2.2.6.10", 5))
        require_ota_ack(build_response(0x52, 0), 0x52)
        with self.assertRaises(DeviceRejected):
            require_ota_ack(build_response(0x52, 1), 0x52)
        with self.assertRaises(ProtocolError):
            require_ota_ack(build_response(0x53, 0), 0x52)

    def test_bootloader_component_is_rejected(self) -> None:
        main = make_main_component()
        bootloader = Component(
            index=main.index,
            entry_id=main.entry_id,
            type_id=1,
            storage_type=main.storage_type,
            filename="ota/s200_bootloader.bin",
            header=main.header,
            payload=main.payload,
        )
        with self.assertRaises(SafetyError):
            validate_main_component(bootloader)

    def test_lost_data_reply_is_never_replayed(self) -> None:
        transport = FakeTransport(timeout_once_sequence=1)
        with self.assertRaises(TransportTimeout):
            MainFirmwareFlasher(
                transport,
                data_retries=1,
                retry_backoff_seconds=6.5,
                batch_settle_seconds=0,
                sleeper=lambda _: None,
            ).flash_main(make_main_component())
        sequence_one = [
            item
            for item in transport.requests
            if item[0] == 0x54 and item[6] == 1
        ]
        self.assertEqual(len(sequence_one), 1)

    def test_explicit_data_rejection_retries_the_exact_record(self) -> None:
        self._assert_exact_retry(FakeTransport(reject_once_sequence=1))

    def test_deferred_batch_settle_increases_late_in_image(self) -> None:
        sleeps: list[float] = []
        MainFirmwareFlasher(
            FakeTransport(),
            batch_settle_seconds=1.0,
            late_batch_settle_seconds=2.0,
            late_batch_threshold=0.75,
            final_settle_seconds=15.0,
            sleeper=sleeps.append,
        ).flash_main(make_main_component(12_000))
        self.assertEqual(sleeps, [1.0, 15.0])

    def test_larger_deferred_batch_reduces_intermediate_settles(self) -> None:
        conservative_sleeps: list[float] = []
        balanced_sleeps: list[float] = []
        component = make_main_component(24_000)
        MainFirmwareFlasher(
            FakeTransport(),
            deferred_batch_size=6_000,
            batch_settle_seconds=1.0,
            late_batch_settle_seconds=2.0,
            final_settle_seconds=15.0,
            sleeper=conservative_sleeps.append,
        ).flash_main(component)
        MainFirmwareFlasher(
            FakeTransport(),
            deferred_batch_size=12_000,
            batch_settle_seconds=0.75,
            late_batch_settle_seconds=1.5,
            final_settle_seconds=15.0,
            sleeper=balanced_sleeps.append,
        ).flash_main(component)
        self.assertEqual(conservative_sleeps, [1.0, 1.0, 2.0, 15.0])
        self.assertEqual(balanced_sleeps, [0.75, 15.0])

    def test_deferred_batch_size_must_align_to_records(self) -> None:
        with self.assertRaisesRegex(ValueError, "positive multiple of 1000"):
            MainFirmwareFlasher(FakeTransport(), deferred_batch_size=6_500)

    def _assert_exact_retry(self, transport: FakeTransport) -> None:
        sleeps: list[float] = []
        result = MainFirmwareFlasher(
            transport,
            data_retries=1,
            retry_backoff_seconds=6.5,
            batch_settle_seconds=0,
            sleeper=sleeps.append,
        ).flash_main(make_main_component())
        data_requests = [item for item in transport.requests if item[0] == 0x54]
        self.assertEqual(result.records_sent, 3)
        self.assertEqual(result.data_retries, 1)
        self.assertEqual(data_requests[1], data_requests[2])
        self.assertIn(6.5, sleeps)

    def test_missing_finish_ack_is_failed_or_uncertain(self) -> None:
        with self.assertRaises(NonIdempotentOtaError) as caught:
            MainFirmwareFlasher(
                FakeTransport(finish_timeout=True),
                batch_settle_seconds=0,
                sleeper=lambda _: None,
            ).flash_main(make_main_component())
        self.assertEqual(caught.exception.stage, "FINISH")
        self.assertEqual(caught.exception.command, 0x55)


if __name__ == "__main__":
    unittest.main()
