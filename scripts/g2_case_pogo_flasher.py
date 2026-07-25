#!/usr/bin/env python3
"""Flash a reviewed G2 main image through the charging-case USB port.

The case STM32 runs a hash-gated bridge only from SRAM.  The bridge selects
one YHM2510 pogo route, permits the read-only 0x24 request and a main-only
0x52/0x53/0x54/0x55 OTA state machine, then restores the case's original
ten-register YHM state byte-for-byte.  It cannot forward a bootloader or
peripheral component header.

This remains a single-slot Apollo application update.  It does not make a
nonbooting temple recoverable and deliberately does not expose arbitrary UART
forwarding.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import struct
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import serial

from g2_case_rom import (
    BootloaderError,
    SRAM_ADDRESS,
    go_sram,
    open_rom_loader,
    read_exact,
    read_memory,
    require_expected_identity,
    restore_application,
    write_sram,
)
from g2_pogo_flasher import (
    FlasherError,
    MainFirmwareFlasher,
    ProtocolError,
    SafetyError,
    TempleTransport,
    TransportTimeout,
    build_package_plan,
    poll_for_version,
)


BRIDGE_BYTES = 2872
BRIDGE_SHA256 = (
    "08a08f45ac125a1dba6469234e56cacd32147d9e79203327987276d2fb182b02"
)
BRIDGE_BANNER = b"G2_POGO_FLASH_BRIDGE_V1\n"
REVIEWED_CFW_SHA256 = (
    "5c1539fd39c599e6035f6a8ec0779ba687c250d342a24c21a39952fed6c56aa0"
)
REVIEWED_OFFICIAL_SHA256 = (
    "f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa"
)
REVIEWED_OFFICIAL_MAIN_SHA256 = (
    "36c5b0e499a68ac2493a497bdab9740fd3e7027730c26a9094eca47268a27863"
)
REVIEWED_OFFICIAL_MAIN_BYTES = 3_523_396
REVIEWED_MAIN_SHA256 = (
    "38dea7dc05e832e6f5aea8fa726454b2ec44055af5d456b323448ee6989e53d1"
)
REVIEWED_MAIN_BYTES = 3_539_474
REVIEWED_BASE_VERSION = "2.2.6.10"
REVIEWED_CASE_VERSION = "1.2.57"
FINAL_RESET_COMMAND = b"DEB0\n"
FINAL_RESET_CONFIRMATION = re.compile(
    rb"reset gls L & R, reason: cmd",
    re.IGNORECASE,
)

RESULT_ADDRESS = 0x20011A00
RESULT_LENGTH = 128
PROOF_ADDRESS = 0x20011B00
PROOF = bytes.fromhex("47465250dec0dec0")
ZERO_PROOF = bytes(len(PROOF))

READY_STATUS = {
    0: "ok",
    1: "bad host request",
    2: "command or OTA state rejected",
    3: "YHM baseline is not an allowlisted seated-idle state",
    4: "YHM route selection failed",
    5: "temple UART transmit failed",
    6: "no complete framed temple response",
    7: "YHM baseline restoration failed",
    16: "host request timeout",
}


def _drain_case_console(port: serial.Serial, duration: float) -> bytes:
    deadline = time.monotonic() + duration
    captured = bytearray()
    while time.monotonic() < deadline:
        captured.extend(port.read(4096))
    return bytes(captured)


def _open_case_console(device: str) -> serial.Serial:
    port = serial.Serial()
    port.port = device
    port.baudrate = 1_000_000
    port.bytesize = serial.EIGHTBITS
    port.parity = serial.PARITY_NONE
    port.stopbits = serial.STOPBITS_ONE
    port.timeout = 0.2
    port.write_timeout = 1.0
    port.dtr = True
    port.rts = True
    port.open()
    time.sleep(0.05)
    port.rts = False
    return port


def parse_case_restore_evidence(
    captured: bytes,
    *,
    require_reset_confirmation: bool,
) -> dict[str, object]:
    versions = re.findall(rb"\bB200 ([0-9.]+)", captured)
    if not versions:
        raise SafetyError("normal case firmware banner was not observed")
    version = versions[-1].decode("ascii", errors="replace")
    if version != REVIEWED_CASE_VERSION:
        raise SafetyError(
            f"case firmware is {version}, expected {REVIEWED_CASE_VERSION}"
        )
    telemetry = re.findall(
        rb"GLS_L:(\d+), GLS_R:(\d+)[^\r\n]*otaGls:(\d+)",
        captured,
    )
    if not telemetry:
        raise SafetyError("fresh case temple-presence telemetry was not observed")
    left_raw, right_raw, ota_raw = telemetry[-1]
    reset_confirmed = bool(FINAL_RESET_CONFIRMATION.search(captured))
    if require_reset_confirmation and not reset_confirmed:
        raise SafetyError(
            "case did not confirm the traced B0 left/right temple reset"
        )
    return {
        "case_version": version,
        "left_present": bool(int(left_raw)),
        "right_present": bool(int(right_raw)),
        "ota_glasses": int(ota_raw),
        "reset_command": FINAL_RESET_COMMAND.decode("ascii").strip(),
        "reset_confirmed": reset_confirmed,
    }


def read_case_preflight(device: str, routes: tuple[str, ...]) -> dict[str, object]:
    """Require case 1.2.57 and fresh presence for every selected route."""
    port = _open_case_console(device)
    try:
        captured = bytearray(_drain_case_console(port, 2.5))
        port.reset_input_buffer()
        if port.write(b"DEA3\n") != 5:
            raise ProtocolError("case telemetry query was truncated")
        port.flush()
        captured.extend(_drain_case_console(port, 1.0))
    finally:
        port.close()

    report = parse_case_restore_evidence(
        bytes(captured),
        require_reset_confirmation=False,
    )
    for route in routes:
        if not report[f"{route}_present"]:
            raise SafetyError(
                f"fresh case telemetry does not report {route} as seated"
            )
    return report


def reset_both_temples_and_recheck(device: str) -> dict[str, object]:
    """Run the traced B0 dual-temple reset after route/case restoration."""
    port = _open_case_console(device)
    try:
        captured = bytearray(_drain_case_console(port, 2.5))
        port.reset_input_buffer()
        if port.write(FINAL_RESET_COMMAND) != len(FINAL_RESET_COMMAND):
            raise ProtocolError("case B0 reset command was truncated")
        port.flush()
        captured.extend(_drain_case_console(port, 2.2))
        if not FINAL_RESET_CONFIRMATION.search(captured):
            raise SafetyError(
                "case did not confirm the traced B0 left/right temple reset"
            )
        time.sleep(6.5)
        port.reset_input_buffer()
        if port.write(b"DEA3\n") != 5:
            raise ProtocolError("post-reset case telemetry query was truncated")
        port.flush()
        captured.extend(_drain_case_console(port, 1.0))
    finally:
        port.close()
    return parse_case_restore_evidence(
        bytes(captured),
        require_reset_confirmation=True,
    )


BRIDGE_BASE64 = (
    "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"
)


def build_bridge() -> bytes:
    """Decode and hash-gate the exact hardware-validated SRAM bridge."""
    try:
        payload = base64.b64decode(BRIDGE_BASE64, validate=True)
    except ValueError as error:
        raise SafetyError("embedded case bridge is not valid base64") from error
    digest = hashlib.sha256(payload).hexdigest()
    if len(payload) != BRIDGE_BYTES or digest != BRIDGE_SHA256:
        raise SafetyError(
            "embedded bridge differs from the reviewed build "
            f"(size={len(payload)}, sha256={digest})"
        )
    if len(payload) % 4:
        raise SafetyError("bridge length is not ROM-write aligned")
    stack_pointer, reset_handler = struct.unpack_from("<II", payload)
    if stack_pointer != 0x2001F000 or reset_handler != 0x20010009:
        raise SafetyError("bridge vector table differs from the reviewed layout")
    return payload


class CaseSramTempleTransport(TempleTransport):
    """Main-only temple transport through a volatile case SRAM bridge."""

    def __init__(self, device: str, route: str) -> None:
        if route not in ("left", "right"):
            raise ValueError("route must be left or right")
        self.device = device
        self.route = route
        self.payload = build_bridge()
        self.port: serial.Serial | None = None
        self.sequence = 0
        self.active = False
        self.bridge_launched = False
        self.restore_verified = False
        self.application_version: str | None = None
        self.close_error: str | None = None
        self.baseline = b""
        self.restored = b""
        self.retained_result: dict[str, object] = {}
        self.completed_transfer: tuple[int, int] | None = None
        self._permitted_writes: set[tuple[int, bytes]] = {
            (PROOF_ADDRESS, ZERO_PROOF),
            (RESULT_ADDRESS, bytes(RESULT_LENGTH)),
        }
        for offset in range(0, len(self.payload), 256):
            self._permitted_writes.add(
                (
                    SRAM_ADDRESS + offset,
                    self.payload[offset : offset + 256],
                )
            )
        self._start()

    def _write_sram(
        self, port: serial.Serial, address_value: int, data: bytes
    ) -> None:
        if (address_value, data) not in self._permitted_writes:
            raise SafetyError("attempted case SRAM write is outside the allowlist")
        write_sram(port, address_value, data)

    def _start(self) -> None:
        port = open_rom_loader(self.device)
        try:
            require_expected_identity(port)
            self._write_sram(port, PROOF_ADDRESS, ZERO_PROOF)
            self._write_sram(port, RESULT_ADDRESS, bytes(RESULT_LENGTH))
            if read_memory(port, PROOF_ADDRESS, len(ZERO_PROOF)) != ZERO_PROOF:
                raise SafetyError("case bridge proof location did not clear")
            if read_memory(port, RESULT_ADDRESS, RESULT_LENGTH) != bytes(
                RESULT_LENGTH
            ):
                raise SafetyError("case bridge result location did not clear")
            for offset in range(0, len(self.payload), 256):
                chunk = self.payload[offset : offset + 256]
                address = SRAM_ADDRESS + offset
                self._write_sram(port, address, chunk)
                if read_memory(port, address, len(chunk)) != chunk:
                    raise SafetyError(
                        f"case SRAM readback differs at 0x{address:08x}"
                    )
            go_sram(port)
            self.bridge_launched = True
            # The ROM-loader opener holds DTR low to select system memory.
            # Release BOOT0 immediately after the verified SRAM jump.  This
            # matches the normal case-application control-line state and makes
            # any subsequent reset return to the case app, not the ROM loader.
            port.dtr = True
            # Keep the case/CH340 leg conservative; the independent USART3
            # pogo leg remains at the temple protocol's 1 Mbaud.
            port.baudrate = 115_200
            port.bytesize = serial.EIGHTBITS
            port.parity = serial.PARITY_NONE
            port.stopbits = serial.STOPBITS_ONE
            port.timeout = 8.0
            banner = read_exact(port, len(BRIDGE_BANNER), "bridge banner")
            if banner != BRIDGE_BANNER:
                raise SafetyError(f"bridge banner mismatch: {banner.hex()}")

            setup = bytearray(b"G2FW")
            setup.extend(
                (
                    1,
                    0 if self.route == "left" else 1,
                    0,
                    0x42,
                    0,
                )
            )
            setup.append(sum(setup) & 0xFF)
            port.write(setup)
            port.flush()
            ready = read_exact(port, 13, "bridge ready response")
            if (
                ready[:4] != b"G2RD"
                or ready[4] != 1
                or ready[6] != setup[5]
                or ready[7] != setup[7]
                or ready[-1] != sum(ready[:-1]) & 0xFF
            ):
                raise SafetyError(f"invalid bridge ready response: {ready.hex()}")
            if ready[5] != 0:
                raise SafetyError(
                    f"bridge setup status {ready[5]}: "
                    f"{READY_STATUS.get(ready[5], 'unknown')}"
                )
            if ready[8:12] != bytes.fromhex("ff03ff03"):
                raise SafetyError(
                    "bridge did not prove complete baseline/selected YHM reads"
                )
            self.port = port
            self.active = True
        except Exception as primary_error:
            if port.is_open:
                port.close()
            cleanup_errors: list[str] = []
            if self.bridge_launched:
                time.sleep(0.35)
                try:
                    self._verify_retained_restore()
                except Exception as error:
                    cleanup_errors.append(
                        f"retained route-restoration proof: {error}"
                    )
            try:
                restore_application(
                    self.device, expected_version=REVIEWED_CASE_VERSION
                )
            except Exception as restore_error:
                cleanup_errors.append(
                    f"case application return: {restore_error}"
                )
            if cleanup_errors:
                raise SafetyError(
                    f"bridge startup failed: {primary_error}; "
                    + "; ".join(cleanup_errors)
                ) from primary_error
            raise

    def drain_input(self) -> None:
        if self.port is not None and self.port.is_open:
            self.port.reset_input_buffer()

    def _write_host_bytes(self, data: bytes, what: str) -> None:
        if self.port is None:
            raise ProtocolError("case bridge is not open")
        written = self.port.write(data)
        self.port.flush()
        if written != len(data):
            raise ProtocolError(
                f"case USB write accepted {written}/{len(data)} bytes for {what}"
            )

    def _read_exact_until(
        self, count: int, deadline: float, what: str
    ) -> bytes:
        if self.port is None:
            raise ProtocolError("case bridge is not open")
        result = bytearray()
        while len(result) < count:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TransportTimeout(
                    f"timeout reading {what}: got {len(result)}/{count} bytes"
                )
            self.port.timeout = min(0.25, remaining)
            chunk = self.port.read(count - len(result))
            if chunk:
                result.extend(chunk)
        return bytes(result)

    def _read_response(self, timeout: float) -> tuple[int, int, bytes]:
        if self.port is None:
            raise ProtocolError("case bridge is not open")
        deadline = time.monotonic() + max(10.0, timeout + 10.0)
        header = self._read_exact_until(
            11, deadline, "case bridge response header"
        )
        if header[:5] != b"G2RX\x01":
            raise ProtocolError(
                f"invalid case bridge response header: {header.hex()}"
            )
        length = header[8]
        if length > 64:
            raise ProtocolError("case bridge capture length exceeds 64")
        tail = self._read_exact_until(
            length + 1,
            deadline,
            "case bridge response payload/checksum",
        )
        response = header + tail
        if response[-1] != sum(response[:-1]) & 0xFF:
            raise ProtocolError("case bridge response checksum is invalid")
        if header[5] != self.sequence:
            raise ProtocolError(
                f"case bridge sequence is {header[5]}, expected {self.sequence}"
            )
        return header[6], header[7], response[11:-1]

    def _exchange(
        self, magic: bytes, request: bytes, timeout: float
    ) -> tuple[int, int, bytes]:
        if not self.active or self.port is None:
            raise ProtocolError("case bridge session is not active")
        if magic not in (b"G2TX", b"G2TS"):
            raise SafetyError("case bridge request magic is not allowlisted")
        if not request or len(request) > 1009:
            raise ProtocolError("temple request length is outside bridge bounds")
        self.sequence = (self.sequence + 1) & 0xFF
        header = bytearray(magic)
        header.extend((1, self.sequence))
        header.extend(struct.pack("<H", len(request)))
        header.append(0)
        header.append(sum(header) & 0xFF)
        self._write_host_bytes(bytes(header), "transaction header")
        deadline = time.monotonic() + 8.0
        if self._read_exact_until(
            1, deadline, "transaction-header flow-control token"
        ) != b"\xc3":
            raise ProtocolError("case bridge rejected the transaction header")
        # macOS occasionally reported a full ~1 KiB buffer accepted although
        # the CH340 delivered a truncated stream.  Stop-and-wait flow control
        # proves that the case consumed each short chunk before sending more.
        for offset in range(0, len(request), 32):
            self._write_host_bytes(
                request[offset : offset + 32],
                f"transaction payload at {offset}",
            )
            deadline = time.monotonic() + 8.0
            if self._read_exact_until(
                1,
                deadline,
                f"transaction payload flow-control token at {offset}",
            ) != b"\xc3":
                raise ProtocolError(
                    f"case bridge did not accept payload chunk at {offset}"
                )
        self._write_host_bytes(
            bytes((sum(request) & 0xFF,)),
            "transaction payload checksum",
        )
        return self._read_response(timeout)

    def transact(self, request: bytes, timeout: float) -> bytes:
        bridge_status, uart_errors, captured = self._exchange(
            b"G2TX", request, timeout
        )
        if uart_errors:
            raise ProtocolError(
                f"case pogo UART reported error mask 0x{uart_errors:02x}"
            )
        if bridge_status == 6:
            raise TransportTimeout("no complete temple frame through case bridge")
        if bridge_status:
            raise SafetyError(
                f"case bridge status {bridge_status}: "
                f"{READY_STATUS.get(bridge_status, 'unknown')}"
            )
        return captured

    def stress_host_receive(self, payload_size: int) -> None:
        if not 1 <= payload_size <= 1009:
            raise ValueError("host stress payload must be between 1 and 1009")
        status, uart_errors, captured = self._exchange(
            b"G2TS", bytes(payload_size), 8.0
        )
        if status or uart_errors or captured:
            raise ProtocolError(
                "host-only stress response was not empty/OK: "
                f"status={status}, errors={uart_errors}, "
                f"captured={captured.hex()}"
            )

    def _request_exit(self) -> bytes:
        if self.port is None or not self.port.is_open:
            raise ProtocolError("case bridge serial port is not open")
        self.sequence = (self.sequence + 1) & 0xFF
        header = bytearray(b"G2TX")
        header.extend((1, self.sequence))
        header.extend(b"\0\0\0")
        header.append(sum(header) & 0xFF)
        self.port.write(header)
        self.port.flush()
        status, errors, captured = self._read_response(10.0)
        if status != 0 or errors != 0 or len(captured) != 10:
            raise ProtocolError(
                f"bridge exit failed status={status}, errors={errors}, "
                f"restored={captured.hex()}"
            )
        return captured

    def _verify_retained_restore(self) -> None:
        port = open_rom_loader(self.device)
        verification_error: Exception | None = None
        cleanup_error: Exception | None = None
        identity_verified = False
        try:
            try:
                require_expected_identity(port)
                identity_verified = True
                proof = read_memory(port, PROOF_ADDRESS, len(PROOF))
                result = read_memory(port, RESULT_ADDRESS, RESULT_LENGTH)
                words = [
                    int.from_bytes(result[offset : offset + 4], "little")
                    for offset in range(0, RESULT_LENGTH, 4)
                ]
                self.retained_result = {
                    "magic": f"0x{words[0]:08x}",
                    "progress": words[1],
                    "route": words[2],
                    "sequence": words[3],
                    "status": words[4],
                    "baseline_mask": f"0x{words[5]:03x}",
                    "selected_mask": f"0x{words[6]:03x}",
                    "restored_mask": f"0x{words[7]:03x}",
                    "write_mask": f"0x{words[8]:x}",
                    "ota_state": words[9],
                    "expected_sequence": words[10],
                    "declared_size": words[11],
                    "accepted_size": words[12],
                    "temple_tx_count": words[13],
                    "temple_rx_count": words[14],
                    "temple_uart_errors": f"0x{words[15]:x}",
                    "host_tx_recoveries": words[24],
                    "host_tx_aborts": words[25],
                    "host_tx_last_isr": f"0x{words[26]:08x}",
                    "host_rx_timeouts": words[27],
                    "host_rx_errors": words[28],
                    "host_tc_timeouts": words[29],
                    "host_stage": words[30],
                    "host_chunk_offset": words[31],
                    "proof": proof.hex(),
                }
                self.baseline = result[64:74]
                self.restored = result[84:94]
                expected_route = 0 if self.route == "left" else 1
                if (
                    proof != PROOF
                    or words[0] != 0x57463247
                    or words[1] != 3
                    or words[2] != expected_route
                    or words[3] != self.sequence
                    or words[4] != 0
                    or words[5] != 0x3FF
                    or words[6] != 0x3FF
                    or words[7] != 0x3FF
                    or words[15] != 0
                    or (
                        self.completed_transfer is not None
                        and (
                            words[11] != self.completed_transfer[0]
                            or words[12] != self.completed_transfer[0]
                            or words[10] != self.completed_transfer[1]
                        )
                    )
                    or self.baseline != self.restored
                ):
                    raise SafetyError(
                        "case bridge restore proof is incomplete or belongs "
                        "to another transaction: "
                        f"retained={self.retained_result}, "
                        f"baseline={self.baseline.hex()}, "
                        f"restored={self.restored.hex()}"
                    )
            except Exception as error:
                verification_error = error

            # Retained proof is volatile, but clear and read it back even when
            # verification failed so a later run cannot inherit stale proof.
            try:
                if not identity_verified:
                    raise SafetyError(
                        "refusing retained-data writes without the exact "
                        "reviewed ROM identity and command table"
                    )
                self._write_sram(port, PROOF_ADDRESS, ZERO_PROOF)
                self._write_sram(port, RESULT_ADDRESS, bytes(RESULT_LENGTH))
                if read_memory(port, PROOF_ADDRESS, len(PROOF)) != ZERO_PROOF:
                    raise SafetyError("retained proof did not clear")
                if (
                    read_memory(port, RESULT_ADDRESS, RESULT_LENGTH)
                    != bytes(RESULT_LENGTH)
                ):
                    raise SafetyError("retained result did not clear")
            except Exception as error:
                cleanup_error = error

            if verification_error is not None or cleanup_error is not None:
                details = []
                if verification_error is not None:
                    details.append(f"verification: {verification_error}")
                if cleanup_error is not None:
                    details.append(f"cleanup: {cleanup_error}")
                raise SafetyError("; ".join(details))
            self.restore_verified = True
        finally:
            if port.is_open:
                port.close()

    def close(self) -> None:
        if self.restore_verified and self.application_version is not None:
            return
        errors: list[str] = []
        if self.active and self.port is not None and self.port.is_open:
            try:
                self.restored = self._request_exit()
            except Exception as error:
                errors.append(f"exit request: {error}")
            finally:
                self.active = False
                self.port.close()
                self.port = None
        time.sleep(0.35)
        try:
            self._verify_retained_restore()
        except Exception as error:
            errors.append(f"retained restore proof: {error}")
        try:
            self.application_version = restore_application(
                self.device, expected_version=REVIEWED_CASE_VERSION
            )
        except Exception as error:
            errors.append(f"case application restore: {error}")
        self.close_error = "; ".join(errors) if errors else None


def _progress(route: str):
    last = -1

    def report(completed: int, total: int) -> None:
        nonlocal last
        percent = completed * 100 // total
        if (
            completed == 1
            or completed == total
            or completed % 50 == 0
            or percent >= last + 5
        ):
            print(
                f"{route}: {completed:,}/{total:,} records "
                f"({completed * 100.0 / total:.1f}%)",
                flush=True,
            )
            last = percent

    return report


def _close_checked(transport: CaseSramTempleTransport) -> None:
    transport.close()
    if transport.close_error is not None:
        raise SafetyError(transport.close_error)
    print(
        f"{transport.route}: YHM baseline restored byte-for-byte "
        f"({transport.baseline.hex()}); case application "
        f"B200 {transport.application_version}",
        flush=True,
    )


def final_reset_and_verify_liveness(
    device: str,
    routes: tuple[str, ...],
    expected_version: str,
) -> dict[str, object]:
    """Make B0 the final temple mutation, then run read-only liveness checks."""
    reset_report = reset_both_temples_and_recheck(device)
    for route in routes:
        if not reset_report[f"{route}_present"]:
            raise SafetyError(
                f"{route}: contact did not return after the final B0 reset"
            )

    versions: dict[str, object] = {}
    for route in routes:
        transport: CaseSramTempleTransport | None = None
        try:
            transport = CaseSramTempleTransport(device, route)
            version = MainFirmwareFlasher(transport).read_version()
            if version.firmware != expected_version or version.hardware != 5:
                raise SafetyError(
                    f"{route}: post-reset expected {expected_version}/hardware 5, "
                    f"observed {version.firmware}/hardware {version.hardware}"
                )
            versions[route] = asdict(version)
        finally:
            if transport is not None:
                _close_checked(transport)
    return {
        "outcome": "success",
        "temple_mutation": "traced stock DEB0 dual-temple reset",
        "case": reset_report,
        "versions": versions,
        "version_is_liveness_not_image_provenance": True,
    }


def can_run_final_reset_after_failure(
    route_results: list[dict[str, object]],
) -> bool:
    """Permit failure recovery only after every attempted route cleaned up."""
    return bool(route_results) and all(
        result.get("case_restore_verified") is True
        and result.get("case_application_version") == REVIEWED_CASE_VERSION
        for result in route_results
    )


def _write_audit(path: Path, audit: dict[str, object]) -> None:
    """Atomically persist a private audit checkpoint."""
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".partial")
    partial.write_text(
        json.dumps(audit, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.chmod(partial, 0o600)
    os.replace(partial, path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect_parser = subparsers.add_parser("inspect")
    inspect_parser.add_argument("image", type=Path)

    preflight = subparsers.add_parser("preflight")
    preflight.add_argument("--device", required=True)
    preflight.add_argument("--route", choices=("left", "right"), required=True)
    preflight.add_argument("--expect-version", default=REVIEWED_BASE_VERSION)
    preflight.add_argument("--glasses-seated-confirmed", action="store_true")

    stress = subparsers.add_parser(
        "stress-preflight",
        help="repeat only the read-only 0x24 query before permitting a flash",
    )
    stress.add_argument("--device", required=True)
    stress.add_argument("--route", choices=("left", "right"), required=True)
    stress.add_argument("--expect-version", default=REVIEWED_BASE_VERSION)
    stress.add_argument("--queries", type=int, default=500)
    stress.add_argument(
        "--interval-ms",
        type=float,
        default=15.0,
        help="delay between short read-only queries (default: 15 ms)",
    )
    stress.add_argument("--glasses-seated-confirmed", action="store_true")

    host_stress = subparsers.add_parser(
        "stress-usb",
        help="exercise large CH340 receive envelopes without touching USART3",
    )
    host_stress.add_argument("--device", required=True)
    host_stress.add_argument(
        "--route", choices=("left", "right"), required=True
    )
    host_stress.add_argument("--transactions", type=int, default=500)
    host_stress.add_argument("--payload-bytes", type=int, default=1009)
    host_stress.add_argument("--glasses-seated-confirmed", action="store_true")

    for command, help_text in (
        (
            "flash-reviewed-cfw",
            "flash the exact reviewed CFW Apollo-main image",
        ),
        (
            "flash-reviewed-official",
            "restore the exact pinned official Apollo-main image",
        ),
    ):
        flash = subparsers.add_parser(command, help=help_text)
        flash.add_argument("image", type=Path)
        flash.add_argument("--device", required=True)
        flash.add_argument(
            "--routes", choices=("both", "left", "right"), default="both"
        )
        flash.add_argument("--glasses-seated-confirmed", action="store_true")
        flash.add_argument("--execute-main-ota", action="store_true")
        flash.add_argument("--accept-single-slot-risk", action="store_true")
        flash.add_argument("--confirm-image-sha256", required=True)
        flash.add_argument(
            "--expect-current-version", default=REVIEWED_BASE_VERSION
        )
        flash.add_argument("--log", type=Path, required=True)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "inspect":
        try:
            plan, _ = build_package_plan(args.image)
            print(json.dumps(asdict(plan), indent=2, sort_keys=True))
            print(f"bridge_sha256={hashlib.sha256(build_bridge()).hexdigest()}")
            return 0
        except (OSError, FlasherError, ValueError) as error:
            print(f"Inspection failed: {error}", file=sys.stderr)
            return 1

    if not args.glasses_seated_confirmed:
        parser.error("hardware access requires --glasses-seated-confirmed")

    if args.command == "stress-usb":
        if not 1 <= args.transactions <= 10_000:
            parser.error("--transactions must be between 1 and 10000")
        if not 1 <= args.payload_bytes <= 1009:
            parser.error("--payload-bytes must be between 1 and 1009")
        transport: CaseSramTempleTransport | None = None
        return_code = 1
        try:
            case_preflight = read_case_preflight(
                args.device, (args.route,)
            )
            print(
                f"case B200 {case_preflight['case_version']}; "
                f"{args.route} presence confirmed",
                flush=True,
            )
            transport = CaseSramTempleTransport(args.device, args.route)
            for index in range(1, args.transactions + 1):
                transport.stress_host_receive(args.payload_bytes)
                if (
                    index == 1
                    or index == args.transactions
                    or index % 100 == 0
                ):
                    print(
                        f"{args.route}: USB host-only transaction "
                        f"{index:,}/{args.transactions:,} "
                        f"({args.payload_bytes:,}-byte payload)",
                        flush=True,
                    )
            return_code = 0
        except (
            OSError,
            FlasherError,
            BootloaderError,
            serial.SerialException,
        ) as error:
            print(f"USB stress failed safely: {error}", file=sys.stderr)
        finally:
            if transport is not None:
                try:
                    _close_checked(transport)
                except FlasherError as error:
                    print(
                        f"Case restore verification failed: {error}",
                        file=sys.stderr,
                    )
                    return_code = 1
        return return_code

    if args.command in ("preflight", "stress-preflight"):
        query_count = 1 if args.command == "preflight" else args.queries
        if not 1 <= query_count <= 10_000:
            parser.error("--queries must be between 1 and 10000")
        query_interval = (
            0.0
            if args.command == "preflight"
            else args.interval_ms / 1_000.0
        )
        if not 0.0 <= query_interval <= 1.0:
            parser.error("--interval-ms must be between 0 and 1000")
        transport: CaseSramTempleTransport | None = None
        return_code = 1
        try:
            case_preflight = read_case_preflight(
                args.device, (args.route,)
            )
            print(
                f"case B200 {case_preflight['case_version']}; "
                f"{args.route} presence confirmed",
                flush=True,
            )
            transport = CaseSramTempleTransport(args.device, args.route)
            flasher = MainFirmwareFlasher(transport)
            for index in range(1, query_count + 1):
                try:
                    observed = flasher.read_version()
                except FlasherError as error:
                    raise ProtocolError(f"query {index}: {error}") from error
                if observed.firmware != args.expect_version:
                    raise SafetyError(
                        f"query {index}: expected {args.expect_version}, "
                        f"observed {observed.firmware}"
                    )
                if observed.hardware != 5:
                    raise SafetyError(
                        f"query {index}: expected hardware 5, "
                        f"observed {observed.hardware}"
                    )
                if (
                    query_count == 1
                    or index == 1
                    or index == query_count
                    or index % 100 == 0
                ):
                    print(
                        f"{args.route}: query {index:,}/{query_count:,}, "
                        f"temple firmware={observed.firmware}, "
                        f"hardware={observed.hardware}",
                        flush=True,
                    )
                if index != query_count and query_interval:
                    time.sleep(query_interval)
            if query_count > 1:
                print(
                    f"{args.route}: completed {query_count:,} consecutive "
                    "read-only transactions",
                    flush=True,
                )
            return_code = 0
        except (
            OSError,
            FlasherError,
            BootloaderError,
            serial.SerialException,
        ) as error:
            print(f"Preflight failed safely: {error}", file=sys.stderr)
        finally:
            if transport is not None:
                try:
                    _close_checked(transport)
                except FlasherError as error:
                    print(f"Case restore verification failed: {error}", file=sys.stderr)
                    return_code = 1
        return return_code

    assert args.command in (
        "flash-reviewed-cfw",
        "flash-reviewed-official",
    )
    image_kind = (
        "CFW"
        if args.command == "flash-reviewed-cfw"
        else "official"
    )
    reviewed_sha256 = (
        REVIEWED_CFW_SHA256
        if args.command == "flash-reviewed-cfw"
        else REVIEWED_OFFICIAL_SHA256
    )
    reviewed_main_sha256 = (
        REVIEWED_MAIN_SHA256
        if args.command == "flash-reviewed-cfw"
        else REVIEWED_OFFICIAL_MAIN_SHA256
    )
    reviewed_main_bytes = (
        REVIEWED_MAIN_BYTES
        if args.command == "flash-reviewed-cfw"
        else REVIEWED_OFFICIAL_MAIN_BYTES
    )
    if not args.execute_main_ota:
        parser.error("flash requires --execute-main-ota")
    if not args.accept_single_slot_risk:
        parser.error("flash requires --accept-single-slot-risk")
    try:
        plan, component = build_package_plan(args.image)
    except (OSError, FlasherError, ValueError) as error:
        print(f"Package validation failed: {error}", file=sys.stderr)
        return 1
    if plan.image_sha256 != reviewed_sha256:
        parser.error(
            "this case bridge command accepts only the reviewed "
            + image_kind
            + " image "
            + reviewed_sha256
        )
    if (
        plan.main_payload_bytes != reviewed_main_bytes
        or plan.main_payload_sha256 != reviewed_main_sha256
    ):
        parser.error(
            "the Apollo-main component does not match the reviewed "
            + image_kind
            + " pin"
        )
    if args.confirm_image_sha256.lower() != plan.image_sha256:
        parser.error(
            "--confirm-image-sha256 does not match the "
            + image_kind
            + " image"
        )

    routes = (
        ("right", "left")
        if args.routes == "both"
        else (args.routes,)
    )
    audit: dict[str, object] = {
        "schema_version": 2,
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "operation": f"g2_case_usb_reviewed_{image_kind.lower()}_main_only",
        "device": args.device,
        "routes": routes,
        "package": asdict(plan),
        "bridge_sha256": BRIDGE_SHA256,
        "bootloader_component_allowed": False,
        "route_results": [],
        "final_reset_and_liveness": None,
        "outcome": "started",
    }
    try:
        _write_audit(args.log, audit)
    except OSError as error:
        print(
            f"Refusing hardware access because the audit log cannot be "
            f"created: {error}",
            file=sys.stderr,
        )
        return 1
    return_code = 1
    try:
        case_preflight = read_case_preflight(args.device, routes)
        audit["case_preflight"] = case_preflight
        _write_audit(args.log, audit)
        print(
            f"case B200 {case_preflight['case_version']}; selected route "
            "presence confirmed",
            flush=True,
        )
        for route in routes:
            transport: CaseSramTempleTransport | None = None
            route_result: dict[str, object] = {"route": route}
            route_error: Exception | None = None
            cleanup_error: Exception | None = None
            try:
                print(f"{route}: loading verified volatile case bridge", flush=True)
                transport = CaseSramTempleTransport(args.device, route)
                flasher = MainFirmwareFlasher(
                    transport,
                    response_timeout=8.0,
                    finish_timeout=60.0,
                    data_retries=2,
                    batch_settle_seconds=0.100,
                    progress=_progress(route),
                )
                current = flasher.read_version()
                route_result["preflight_version"] = asdict(current)
                print(
                    f"{route}: preflight firmware={current.firmware}, "
                    f"hardware={current.hardware}",
                    flush=True,
                )
                if current.firmware != args.expect_current_version:
                    raise SafetyError(
                        f"{route}: expected firmware "
                        f"{args.expect_current_version}, observed "
                        f"{current.firmware}"
                    )
                if current.hardware != 5:
                    raise SafetyError(
                        f"{route}: expected hardware 5, "
                        f"observed {current.hardware}"
                    )
                print(
                    f"{route}: starting reviewed {image_kind} "
                    "Apollo-main transfer; "
                    "do not disturb the case",
                    flush=True,
                )
                transfer = flasher.flash_main(component)
                transport.completed_transfer = (
                    transfer.payload_bytes_sent,
                    transfer.records_sent,
                )
                route_result["transfer"] = asdict(transfer)
                postflight = poll_for_version(
                    flasher,
                    plan.expected_device_version,
                    timeout=180.0,
                    interval=2.0,
                )
                route_result["postflight_version"] = asdict(postflight)
                if postflight.hardware != 5:
                    raise SafetyError(
                        f"{route}: postflight hardware changed to "
                        f"{postflight.hardware}"
                    )
                print(
                    f"{route}: postflight firmware={postflight.firmware}, "
                    f"hardware={postflight.hardware}",
                    flush=True,
                )
            except (
                OSError,
                FlasherError,
                BootloaderError,
                serial.SerialException,
            ) as error:
                route_error = error
            finally:
                if transport is not None:
                    try:
                        _close_checked(transport)
                    except (
                        OSError,
                        FlasherError,
                        BootloaderError,
                        serial.SerialException,
                    ) as error:
                        cleanup_error = error
                    finally:
                        route_result["case_restore_verified"] = (
                            transport.restore_verified
                        )
                        route_result["case_application_version"] = (
                            transport.application_version
                        )
                        route_result["yhm_baseline"] = transport.baseline.hex()
                        route_result["retained_result"] = (
                            transport.retained_result
                        )
            if route_error is not None or cleanup_error is not None:
                route_result["outcome"] = "failed_or_uncertain"
                if route_error is not None:
                    route_result["error"] = str(route_error)
                if cleanup_error is not None:
                    route_result["cleanup_error"] = str(cleanup_error)
                cast_results = audit["route_results"]
                assert isinstance(cast_results, list)
                cast_results.append(route_result)
                _write_audit(args.log, audit)
                if route_error is not None and cleanup_error is not None:
                    raise SafetyError(
                        f"primary transaction: {route_error}; "
                        f"cleanup verification: {cleanup_error}"
                    )
                if route_error is not None:
                    raise route_error
                assert cleanup_error is not None
                raise cleanup_error
            route_result["outcome"] = "success"
            cast_results = audit["route_results"]
            assert isinstance(cast_results, list)
            cast_results.append(route_result)
            _write_audit(args.log, audit)
        print(
            "All selected routes and the case application are restored; "
            "sending the final traced B0 dual-temple reset",
            flush=True,
        )
        final_reset = final_reset_and_verify_liveness(
            args.device,
            routes,
            plan.expected_device_version,
        )
        audit["final_reset_and_liveness"] = final_reset
        _write_audit(args.log, audit)
        print(
            "Final B0 reset confirmed; selected contacts and checksum-valid "
            "post-reset version replies verified",
            flush=True,
        )
        audit["outcome"] = "success"
        return_code = 0
    except (
        OSError,
        FlasherError,
        BootloaderError,
        serial.SerialException,
    ) as error:
        audit["outcome"] = "failed_or_uncertain"
        audit["error"] = str(error)
        route_results = audit["route_results"]
        assert isinstance(route_results, list)
        if (
            audit["final_reset_and_liveness"] is None
            and can_run_final_reset_after_failure(route_results)
        ):
            try:
                audit["final_reset_and_liveness"] = (
                    final_reset_and_verify_liveness(
                        args.device,
                        routes,
                        plan.expected_device_version,
                    )
                )
                print(
                    "Transfer remains failed or uncertain; final B0 reset and "
                    "post-reset liveness nevertheless verified",
                    file=sys.stderr,
                    flush=True,
                )
            except (
                OSError,
                FlasherError,
                BootloaderError,
                serial.SerialException,
            ) as reset_error:
                audit["final_reset_and_liveness"] = {
                    "outcome": "failed",
                    "error": str(reset_error),
                }
        print(
            "Flash stopped; the current route may be incomplete or uncertain: "
            f"{error}",
            file=sys.stderr,
            flush=True,
        )
    finally:
        audit["finished_at_utc"] = datetime.now(timezone.utc).isoformat()
        try:
            _write_audit(args.log, audit)
            print(f"Wrote audit log: {args.log}")
        except OSError as error:
            print(f"Could not write audit log: {error}", file=sys.stderr)
            return_code = 1
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
