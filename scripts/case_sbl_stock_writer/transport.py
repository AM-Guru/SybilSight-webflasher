"""Fail-closed live binding for the schema-13 volatile Case bridge.

Importing this module cannot open a device.  Construction requires both exact
risk tokens, an inspected bridge artifact, and an explicit bridge digest.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from case_sbl_stock_writer.artifacts import inspect
from g2_case_pogo_flasher import (
    CaseSramTempleTransport,
    FLASH_RESPONSE_SCAN_LIMIT,
    PROOF_ADDRESS,
    RESULT_ADDRESS,
    RESULT_LENGTH,
    SBL_CAPTURE_BYTES,
    ZERO_PROOF,
)
from g2_pogo_flasher import ProtocolError, SafetyError, TransportTimeout
from g2_sbl_wire import (
    CASE_BRIDGE_MAX_DATA_BYTES,
    data_frame,
    hello_frame,
    ota_descriptor_frame,
    reset_frame,
    update_frame,
)
from g2_sbl_writer import DEVICE_RISK_TOKEN, FIRMWARE_RISK_TOKEN


class Schema13CaseTransport(CaseSramTempleTransport):
    """One-shot exact-stock SBL transport; no phase can be replayed."""

    def __init__(
        self,
        device: str,
        route: str,
        *,
        build: Path,
        stock_image: Path,
        baud: int,
        expected_bridge_sha256: str,
        device_risk_token: str,
        firmware_risk_token: str,
    ) -> None:
        if (
            device_risk_token != DEVICE_RISK_TOKEN
            or firmware_risk_token != FIRMWARE_RISK_TOKEN
        ):
            raise SafetyError("both exact operator risk tokens are required")
        if route not in ("left", "right"):
            raise ValueError("route must be left or right")
        manifest, bridge = inspect(
            Path(build), Path(stock_image), expected_baud=baud
        )
        digest = hashlib.sha256(bridge).hexdigest()
        if digest != expected_bridge_sha256.lower():
            raise SafetyError("schema-13 bridge SHA-256 differs")

        self.device = device
        self.route = route
        self.require_route_phase = False
        self.observed_charging_phase = False
        self.sbl_hello_probe = True
        self.max_capture_bytes = SBL_CAPTURE_BYTES
        self.payload = bridge
        self.port = None
        self.sequence = 0
        self.active = False
        self.bridge_launched = False
        self.restore_verified = False
        self.application_version = None
        self.close_error = None
        self.baseline = b""
        self.restored = b""
        self.retained_result = {}
        self.completed_transfer = None
        self.last_query_response = {}
        self._stock = Path(stock_image).read_bytes()
        self._writer_phase = "hello"
        self._next_data_offset = 0
        self._terminal_failure = False
        self.schema13_manifest = manifest
        self.temple_baud = baud
        self._permitted_writes = {
            (PROOF_ADDRESS, ZERO_PROOF),
            (RESULT_ADDRESS, bytes(RESULT_LENGTH)),
        }
        for offset in range(0, len(self.payload), 256):
            self._permitted_writes.add(
                (self.payload_address + offset, self.payload[offset:offset + 256])
            )
        self._start()

    @property
    def payload_address(self) -> int:
        # Kept as a property so unit tests can prove the inherited SRAM target.
        from g2_case_rom import SRAM_ADDRESS

        return SRAM_ADDRESS

    def _expected_request(self, label: str) -> tuple[bytes, str, int]:
        phase = self._writer_phase
        if phase == "hello" and label == "HELLO":
            return hello_frame(), "descriptor", 0
        if phase == "descriptor" and label == "OTADESC":
            return ota_descriptor_frame(), "update", 0
        if phase == "update" and label == "UPDATE":
            return update_frame(self._stock), "data", 0
        if phase == "data":
            offset = self._next_data_offset
            if label != f"DATA:{offset}":
                raise SafetyError("schema-13 DATA label or order differs")
            chunk = self._stock[offset:offset + CASE_BRIDGE_MAX_DATA_BYTES]
            if not chunk:
                raise SafetyError("schema-13 DATA exceeds the exact stock image")
            next_offset = offset + len(chunk)
            next_phase = "reset" if next_offset == len(self._stock) else "data"
            return data_frame(offset, chunk), next_phase, next_offset
        if phase == "reset" and label == "RESET":
            return reset_frame(), "done", len(self._stock)
        raise SafetyError(
            f"schema-13 command {label!r} is not allowed in phase {phase!r}"
        )

    def transact(self, request: bytes, *, timeout: float, label: str) -> bytes:
        if self._terminal_failure:
            raise SafetyError("schema-13 transport is terminal after a prior failure")
        try:
            expected, next_phase, next_offset = self._expected_request(label)
        except Exception:
            self._terminal_failure = True
            raise
        if bytes(request) != expected:
            self._terminal_failure = True
            raise SafetyError(f"schema-13 exact request differs for {label}")
        # Advance before I/O. A timeout is ambiguous and can therefore never
        # cause this instance to replay the command.
        self._writer_phase = next_phase
        self._next_data_offset = next_offset
        try:
            return super().transact(bytes(request), timeout)
        except Exception:
            self._terminal_failure = True
            raise

    def _read_header_flow_token(self, deadline: float) -> None:
        """Discard a late checksum-valid STATUS/ACK before accepting C3."""
        if self.port is None:
            raise ProtocolError("case bridge is not open")
        window = bytearray()
        inspected = 0
        cached_frames = 0
        while inspected < FLASH_RESPONSE_SCAN_LIMIT:
            byte = self._read_exact_until(
                1, deadline, "schema-13 transaction-header flow-control stream"
            )[0]
            inspected += 1
            if byte == 0xC3 and not window:
                return
            window.append(byte)
            if len(window) > 4:
                del window[0]
            if window != b"G2RX":
                continue
            suffix = self._read_exact_until(
                7, deadline, "schema-13 late cached G2RX header suffix"
            )
            inspected += 7
            header = b"G2RX" + suffix
            if header[4] != 1 or header[8] > self.max_capture_bytes:
                raise ProtocolError("schema-13 late cached G2RX header is invalid")
            tail = self._read_exact_until(
                header[8] + 1,
                deadline,
                "schema-13 late cached G2RX payload/checksum",
            )
            inspected += len(tail)
            frame = header + tail
            if frame[-1] != sum(frame[:-1]) & 0xFF:
                raise ProtocolError("schema-13 late cached response checksum is invalid")
            cached_frames += 1
            window.clear()
        raise ProtocolError(
            "schema-13 bridge emitted "
            f"{inspected} bytes without transaction-header token c3; "
            f"discarded cached frames={cached_frames}"
        )


__all__ = ["Schema13CaseTransport"]
