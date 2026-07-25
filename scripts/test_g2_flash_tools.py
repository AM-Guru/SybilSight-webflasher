#!/usr/bin/env python3
"""Offline tests for the direct-UART and case-USB G2 flash tooling."""

from __future__ import annotations

import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from g2_case_pogo_flasher import (  # noqa: E402
    BRIDGE_BYTES,
    BRIDGE_SHA256,
    _write_audit,
    build_bridge,
)
from g2_pogo_flasher import (  # noqa: E402
    DeviceRejected,
    MainFirmwareFlasher,
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


class G2FlashToolTests(unittest.TestCase):
    def test_protocol_vectors(self) -> None:
        protocol_self_test()

    def test_embedded_case_bridge_is_pinned(self) -> None:
        payload = build_bridge()
        self.assertEqual(len(payload), BRIDGE_BYTES)
        import hashlib

        self.assertEqual(hashlib.sha256(payload).hexdigest(), BRIDGE_SHA256)
        self.assertEqual(struct.unpack_from("<II", payload), (0x2001F000, 0x20010009))

    def test_audit_checkpoints_are_private_and_atomic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "flash-audit.json"
            _write_audit(path, {"outcome": "started"})
            self.assertEqual(path.read_text(encoding="utf-8"), '{\n  "outcome": "started"\n}\n')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertFalse(path.with_suffix(".json.partial").exists())

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

    def test_lost_data_reply_retries_the_exact_record(self) -> None:
        self._assert_exact_retry(FakeTransport(timeout_once_sequence=1))

    def test_explicit_data_rejection_retries_the_exact_record(self) -> None:
        self._assert_exact_retry(FakeTransport(reject_once_sequence=1))

    def _assert_exact_retry(self, transport: FakeTransport) -> None:
        sleeps: list[float] = []
        result = MainFirmwareFlasher(
            transport,
            data_retries=2,
            batch_settle_seconds=0,
            sleeper=sleeps.append,
        ).flash_main(make_main_component())
        data_requests = [item for item in transport.requests if item[0] == 0x54]
        self.assertEqual(result.records_sent, 3)
        self.assertEqual(result.data_retries, 1)
        self.assertEqual(data_requests[1], data_requests[2])
        self.assertIn(0.050, sleeps)

    def test_missing_finish_ack_is_failed_or_uncertain(self) -> None:
        with self.assertRaises(TransportTimeout):
            MainFirmwareFlasher(
                FakeTransport(finish_timeout=True),
                batch_settle_seconds=0,
                sleeper=lambda _: None,
            ).flash_main(make_main_component())


if __name__ == "__main__":
    unittest.main()
