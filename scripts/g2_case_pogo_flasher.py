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
import zlib
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
    NonIdempotentOtaError,
    ProtocolError,
    SafetyError,
    TempleTransport,
    TransportTimeout,
    build_package_plan,
    poll_for_version,
)


BRIDGE_BYTES = 2952
BRIDGE_SHA256 = (
    "eba56380f04bf00ad9d87dffbc40c3292ec5b3cee458d3607c8cffd0dcbe335b"
)
OBSERVED_CHARGING_BRIDGE_SHA256 = (
    "b341adc44630ffe87b572523ace82b2581785892fff6d7de4e3cf1b0c87861d2"
)
SBL_HELLO_PROBE_BRIDGE_SHA256 = (
    "1a20b88c93dde23a7d08bda16efa4e5c7f40dc315e8787bf06fcbef109763404"
)
SBL_HELLO_PROBE_CHARGING_BRIDGE_SHA256 = (
    "2729f38cd9ac3f0e363412a382743532657fb5d33776c415c2ace987cefa2cd1"
)
OBSERVED_CHARGING_TABLE_OFFSETS = (2826, 2836, 2846, 2856)
BRIDGE_BANNER = b"G2_POGO_FLASH_BRIDGE_V7\n"
SBL_HELLO_HEADER = struct.pack("<I", 8 << 16)
SBL_HELLO_REQUEST = (
    struct.pack("<I", zlib.crc32(SBL_HELLO_HEADER) & 0xFFFFFFFF)
    + SBL_HELLO_HEADER
)
SBL_STATUS_MESSAGE_TYPE = 1
SBL_CAPTURE_BYTES = 128
REVIEWED_CFW_SHA256 = (
    "105032302d02ccf943b785070cf15877a918c120b7ca1332bb6261f70eb6d683"
)
REVIEWED_OFFICIAL_SHA256 = (
    "f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa"
)
REVIEWED_OFFICIAL_MAIN_SHA256 = (
    "36c5b0e499a68ac2493a497bdab9740fd3e7027730c26a9094eca47268a27863"
)
REVIEWED_OFFICIAL_MAIN_BYTES = 3_523_396
REVIEWED_MAIN_SHA256 = (
    "2d82addd4c9916781b50f7be377645b797f10856a460bc5190f3172e7161614e"
)
REVIEWED_MAIN_BYTES = 3_543_523
REVIEWED_BASE_VERSION = "2.2.6.10"
REVIEWED_CFW_VERSION = "2.2.6.11"
OPENCFW_2_2_6_RELEASE_SHA256 = (
    "755e25c3f1685749918e84c1f0af64cbe1635d5f5a4b73e294cab0a517b8c95b"
)
OPENCFW_2_2_6_RELEASE_MAIN_SHA256 = (
    "c8275de8f328c3dd86ed74d9ebee4e37aff02c5959e4a56af9305eebd9a592f0"
)
OPENCFW_2_2_6_RELEASE_MAIN_BYTES = 3_714_962
OPENCFW_2_2_6_RELEASE_VERSION = "2.2.6.0"
CFW_2_2_9_CANDIDATE_SHA256 = (
    "dc4c4de98d183a98f8b2e98b91ab0c920b46a1ec30fcdf3d447637f2022df484"
)
CFW_2_2_9_CANDIDATE_MAIN_SHA256 = (
    "0f41679fdd38877b57e3d12f7aaddc36771fa51ecd7e118bf23dfa0eb1b47d74"
)
CFW_2_2_9_CANDIDATE_MAIN_BYTES = 3_731_795
CFW_2_2_9_CANDIDATE_VERSION = "2.2.9.28"
CFW_2_2_9_CANDIDATE_SOURCE_VERSIONS = {
    "2.2.9.22",
    "2.2.9.25",
    "2.2.9.26",
    "2.2.9.27",
    "2.2.9.28",
}
REVIEWED_CASE_VERSION = "1.2.57"
FINAL_RESET_COMMAND = b"DEB0\n"
FINAL_RESET_CONFIRMATION = re.compile(
    rb"reset gls L & R, reason: cmd",
    re.IGNORECASE,
)
POST_RESET_TELEMETRY_ATTEMPTS = 3
POST_RESET_REOPEN_DELAY_SECONDS = 0.5
# Repeated read-only probes consume the same short app-mode route needed by the
# first OTA state transition. Hardware reproduced a missing START after a
# 10-query gate, then acknowledged the identical START after one fresh version
# query. Use the checksum-valid query as a just-in-time liveness gate; repeated
# probes are diagnostic load, not evidence that the later mutation will work.
FLASH_STABILITY_QUERIES = 1
FLASH_STABILITY_INTERVAL_SECONDS = 0.025
FLASH_RESPONSE_SCAN_LIMIT = 256
FLASH_RESPONSE_CANDIDATE_GAP_SECONDS = 2.0
FLASH_HOST_HEADER_BYTE_INTERVAL_SECONDS = 0.005
RECENT_RESET_PROOF_MAX_AGE_SECONDS = 120.0
# A status-3 setup stop with the exact opposite-route baseline is a charging
# phase, not a bridge failure.  Keep the normal Case application running long
# enough for that phase to settle before another fresh SRAM setup.  These are
# the writer rungs already exercised by the browser implementation; entering
# the loader again immediately only samples the same external YHM2510 state.
ROUTE_PHASE_SETTLE_SECONDS = (45.0, 90.0, 180.0)
PACING_PROFILES = {
    "conservative": {
        "deferred_batch_size": 6_000,
        "batch_settle_seconds": 1.000,
        "late_batch_settle_seconds": 2.000,
        "late_batch_threshold": 0.75,
        "final_settle_seconds": 15.000,
        "hardware_qualified": True,
    },
    # Use only for a fresh whole-component retry after exact cleanup and the
    # bilateral reset/liveness gate. Hardware completed this policy after an
    # explicit DATA rejection; the rejected record itself is never replayed.
    "conservative-retry": {
        "deferred_batch_size": 6_000,
        "batch_settle_seconds": 2.000,
        "late_batch_settle_seconds": 4.000,
        "late_batch_threshold": 0.75,
        "final_settle_seconds": 30.000,
        "hardware_qualified": True,
    },
    # This reduces scheduled idle time by batching twice as many accepted bytes.
    # A 2026-07-26 right-Stock recovery explicitly rejected DATA at 691,000
    # accepted bytes, so it remains opt-in research and must never be promoted
    # merely from elapsed-time estimates.
    "balanced-lab": {
        "deferred_batch_size": 12_000,
        "batch_settle_seconds": 0.750,
        "late_batch_settle_seconds": 1.500,
        "late_batch_threshold": 0.75,
        "final_settle_seconds": 15.000,
        "hardware_qualified": False,
    },
}

RESULT_ADDRESS = 0x20011A00
RESULT_LENGTH = 128
PROOF_ADDRESS = 0x20011B00
PROOF = bytes.fromhex("47465250dec0dec0")
ZERO_PROOF = bytes(len(PROOF))
ALLOWED_YHM_BASELINES = {
    bytes.fromhex(value)
    for value in (
        "811104afaf038d2022ff",
        "810004aeae03812022ff",
        "811104afaf03812022ff",
        "810104afae03812022ff",
        "811004aeaf03812022ff",
        # Observed after a confirmed DEB0 reset with Case 1.2.57 and both
        # contacts present. Only register 8 differs from the established
        # both-seated 0x22 phase; the bridge still requires exact byte-for-byte
        # restoration before the case application may resume.
        "811104afaf03812033ff",
        "810004aeae03812033ff",
        "810104afae03812033ff",
        "811004aeaf03812033ff",
    )
}

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
    presence_telemetry = re.findall(
        rb"GLS_L:(\d+), GLS_R:(\d+)",
        captured,
    )
    if not presence_telemetry:
        raise SafetyError("fresh case temple-presence telemetry was not observed")
    left_raw, right_raw = presence_telemetry[-1]
    ota_telemetry = re.findall(rb"otaGls:(\d+)", captured)
    reset_confirmed = bool(FINAL_RESET_CONFIRMATION.search(captured))
    if require_reset_confirmation and not reset_confirmed:
        raise SafetyError(
            "case did not confirm the traced B0 left/right temple reset"
        )
    return {
        "case_version": version,
        "left_present": bool(int(left_raw)),
        "right_present": bool(int(right_raw)),
        "ota_glasses": int(ota_telemetry[-1]) if ota_telemetry else None,
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


def read_post_reset_case_telemetry(
    device: str,
    attempts: int = POST_RESET_TELEMETRY_ATTEMPTS,
) -> dict[str, object]:
    """Reopen the normal console and retry fresh telemetry after a B0 reset."""
    if attempts < 1:
        raise ValueError("post-reset telemetry attempts must be positive")
    errors: list[str] = []
    for attempt in range(1, attempts + 1):
        port: serial.Serial | None = None
        try:
            port = _open_case_console(device)
            captured = bytearray(_drain_case_console(port, 2.5))
            port.reset_input_buffer()
            if port.write(b"DEA0\n") != 5:
                raise ProtocolError(
                    "post-reset case version query was truncated"
                )
            port.flush()
            captured.extend(_drain_case_console(port, 0.9))
            port.reset_input_buffer()
            if port.write(b"DEA3\n") != 5:
                raise ProtocolError(
                    "post-reset case telemetry query was truncated"
                )
            port.flush()
            captured.extend(_drain_case_console(port, 1.0))
            report = parse_case_restore_evidence(
                bytes(captured),
                require_reset_confirmation=False,
            )
            report["post_reset_telemetry_session"] = "reopened"
            report["post_reset_telemetry_attempt"] = attempt
            return report
        except (
            OSError,
            FlasherError,
            serial.SerialException,
        ) as error:
            errors.append(f"attempt {attempt}: {error}")
        finally:
            if port is not None:
                port.close()
        if attempt != attempts:
            time.sleep(POST_RESET_REOPEN_DELAY_SECONDS)
    raise SafetyError(
        "fresh case telemetry did not return after "
        f"{attempts} reopened serial sessions ({'; '.join(errors)})"
    )


def reset_both_temples_and_recheck(device: str) -> dict[str, object]:
    """Confirm B0, then verify telemetry through a newly opened serial session."""
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
    finally:
        port.close()
    # Hardware observation: the Case can confirm DEB0 yet omit A3 telemetry in
    # that same console session while both temple links restart. Closing and
    # reopening the normal console produced fresh GLS_L/GLS_R state.
    time.sleep(6.5)
    report = read_post_reset_case_telemetry(device)
    report["reset_command"] = FINAL_RESET_COMMAND.decode("ascii").strip()
    report["reset_confirmed"] = True
    report["reset_confirmation_session"] = "pre-restart"
    return report


BRIDGE_BASE64 = (
    "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"
)


def build_bridge(*, observed_charging_phase: bool = False) -> bytes:
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
    if observed_charging_phase:
        candidate = bytearray(payload)
        for offset in OBSERVED_CHARGING_TABLE_OFFSETS:
            if candidate[offset : offset + 2] != b"\x22\xff":
                raise SafetyError(
                    "candidate bridge baseline table differs from the reviewed layout"
                )
            candidate[offset] = 0x33
        payload = bytes(candidate)
        digest = hashlib.sha256(payload).hexdigest()
        if digest != OBSERVED_CHARGING_BRIDGE_SHA256:
            raise SafetyError(
                "candidate bridge charging-phase transform is not reproducible"
            )
    stack_pointer, reset_handler = struct.unpack_from("<II", payload)
    if stack_pointer != 0x2001F000 or reset_handler != 0x20010009:
        raise SafetyError("bridge vector table differs from the reviewed layout")
    return payload


def build_sbl_hello_probe_bridge(
    *, observed_charging_phase: bool = False
) -> bytes:
    """Build the exact read-only Apollo SBL HELLO probe bridge.

    This derives from the reviewed V7 running-application bridge, but replaces
    its request validator with an exact eight-byte Ambiq HELLO validator and
    replaces the framed application receiver with a bounded raw UART capture.
    It cannot accept OTA, DATA, RESET, ABORT, or arbitrary temple bytes.
    """
    payload = bytearray(
        build_bridge(observed_charging_phase=observed_charging_phase)
    )

    patches = (
        (
            0x380,
            bytes.fromhex(
                "70b504460d462678242e08d0522e0ed0532e12d0542e2fd0552e67d0"
                "73e0052d71d1786a002866d0"
            ),
            bytes.fromhex(
                "10b5082909d10268054b9a4205d14268044b9a4201d1012010bd0020"
                "10bd00bf14559de900000800"
            ),
            # The surrounding bridge treats zero as an accepted request.
            # Swap the two return immediates after assembling the compact
            # validator below; keeping this in the pinned patch prevents a
            # permissive fallback or a second accepted command.
        ),
        (
            0x63C,
            bytes.fromhex(
                "fcb504460d46002600271e4b1e4a1278522a05d0532a03d0542a01d0"
                "552a00d11a4b1b48c1690f220a4017432022114221d0416ac9b2ae42"
                "1dd2002e02d15a2919d10ee0012e05d1a5290ad000265a2911d106e0"
                "022e04d1ff2902d000265a2909d1a1550136042e05d3e1780531a942"
                "04d88e4203d2013bd4d100e0002630463946fcbd"
            ),
            bytes.fromhex(
                "f0b504460d46002600270b4b0b48c1690f220a4017432022114207d0"
                "416ac9b2ae4205d2a155761cae4201d25b1eeed130463946f0bd00bf"
                "0000000400480040"
            )
            + bytes.fromhex("00bf") * 34,
        ),
        (0x2B8, bytes.fromhex("4021"), bytes.fromhex("8021")),
        (0x2C8, bytes.fromhex("0528"), bytes.fromhex("0128")),
        (0x2CC, bytes.fromhex("2a4c"), bytes.fromhex("08e0")),
        (
            0x2E4,
            bytes.fromhex("00f0d1f8"),
            bytes.fromhex("00bf00bf"),
        ),
        (
            0x5D4,
            bytes.fromhex("402e00d94026"),
            bytes.fromhex("802e00d98026"),
        ),
    )
    for offset, expected, replacement in patches:
        if len(expected) != len(replacement):
            raise SafetyError("SBL bridge patch changes the reviewed layout")
        if payload[offset : offset + len(expected)] != expected:
            raise SafetyError(
                f"SBL bridge source bytes differ at offset 0x{offset:x}"
            )
        payload[offset : offset + len(replacement)] = replacement

    if payload[0x396:0x398] != bytes.fromhex("0120") or payload[
        0x39A:0x39C
    ] != bytes.fromhex("0020"):
        raise SafetyError("SBL validator return sites differ from reviewed bytes")
    payload[0x396:0x398] = bytes.fromhex("0020")
    payload[0x39A:0x39C] = bytes.fromhex("0120")

    result = bytes(payload)
    expected_digest = (
        SBL_HELLO_PROBE_CHARGING_BRIDGE_SHA256
        if observed_charging_phase
        else SBL_HELLO_PROBE_BRIDGE_SHA256
    )
    if len(result) != BRIDGE_BYTES or hashlib.sha256(result).hexdigest() != (
        expected_digest
    ):
        raise SafetyError("SBL HELLO probe bridge differs from reviewed bytes")
    return result


def parse_sbl_status_response(captured: bytes) -> dict[str, object]:
    """Validate and decode a complete Apollo wired-HELLO STATUS response."""
    if len(captured) < 8:
        raise ProtocolError("Apollo SBL response is shorter than its header")
    declared_crc, message = struct.unpack_from("<II", captured)
    message_type = message & 0xFFFF
    declared_length = message >> 16
    if message_type != SBL_STATUS_MESSAGE_TYPE:
        raise ProtocolError(
            f"Apollo SBL returned message type {message_type}, expected STATUS"
        )
    if declared_length < 24 or declared_length > SBL_CAPTURE_BYTES:
        raise ProtocolError(
            f"Apollo SBL declared invalid STATUS length {declared_length}"
        )
    if len(captured) < declared_length:
        raise ProtocolError(
            "Apollo SBL STATUS was truncated: "
            f"captured {len(captured)}/{declared_length} bytes"
        )
    frame = captured[:declared_length]
    calculated_crc = zlib.crc32(frame[4:]) & 0xFFFFFFFF
    if calculated_crc != declared_crc:
        raise ProtocolError(
            "Apollo SBL STATUS CRC mismatch: "
            f"declared 0x{declared_crc:08x}, calculated 0x{calculated_crc:08x}"
        )
    return {
        "message_type": message_type,
        "declared_length": declared_length,
        "protocol_version": struct.unpack_from("<I", frame, 8)[0],
        "max_storage": struct.unpack_from("<I", frame, 12)[0],
        "status": struct.unpack_from("<I", frame, 16)[0],
        "state": struct.unpack_from("<I", frame, 20)[0],
        "crc32": f"0x{declared_crc:08x}",
        "frame_hex": frame.hex(),
        "trailing_bytes_hex": captured[declared_length:].hex(),
    }


class CaseSramTempleTransport(TempleTransport):
    """Main-only temple transport through a volatile case SRAM bridge."""

    def __init__(
        self,
        device: str,
        route: str,
        *,
        require_route_phase: bool = False,
        observed_charging_phase: bool = False,
        sbl_hello_probe: bool = False,
    ) -> None:
        if route not in ("left", "right"):
            raise ValueError("route must be left or right")
        self.device = device
        self.route = route
        self.require_route_phase = require_route_phase
        self.observed_charging_phase = observed_charging_phase
        self.sbl_hello_probe = sbl_hello_probe
        self.max_capture_bytes = (
            SBL_CAPTURE_BYTES if sbl_hello_probe else 64
        )
        self.payload = (
            build_sbl_hello_probe_bridge(
                observed_charging_phase=observed_charging_phase
            )
            if sbl_hello_probe
            else build_bridge(
                observed_charging_phase=observed_charging_phase
            )
        )
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
            # The bridge retains the ROM loader's 115,200 8E1 framing so
            # Web Serial never needs a close/reopen transition after GO.
            port.parity = serial.PARITY_EVEN
            port.timeout = 8.0
            banner = read_exact(port, len(BRIDGE_BANNER), "bridge banner")
            if banner != BRIDGE_BANNER:
                raise SafetyError(f"bridge banner mismatch: {banner.hex()}")

            setup = bytearray(b"G2FW")
            setup.extend(
                (
                    1,
                    0 if self.route == "left" else 1,
                    int(self.require_route_phase),
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

    def _write_host_header(self, data: bytes) -> None:
        """Pace the fixed header across the CH340 after an idle transition."""
        if len(data) != 10:
            raise ProtocolError("case bridge transaction header must be 10 bytes")
        # Two hardware START attempts retained host_chunk_offset=5: the first
        # independently flushed five-byte write arrived, while the second was
        # silently lost by the CH340 path. Flush each header byte separately so
        # no USB packet boundary contains the entire missing suffix. The total
        # 45 ms pacing remains well inside the bridge's bounded per-byte timer.
        for offset, byte in enumerate(data):
            self._write_host_bytes(
                bytes((byte,)), f"transaction header byte {offset}"
            )
            if offset + 1 < len(data):
                time.sleep(FLASH_HOST_HEADER_BYTE_INTERVAL_SECONDS)

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
        # Preserve the application bridge's historical limit for older
        # callers and lightweight test fixtures that bypass __init__.  The
        # separately selected SBL probe explicitly raises this to 128 bytes.
        max_capture_bytes = getattr(self, "max_capture_bytes", 64)
        deadline = time.monotonic() + max(10.0, timeout + 10.0)
        window = bytearray()
        candidate: bytearray | None = None
        expected_length: int | None = None
        inspected = 0
        discarded = 0
        last_problem: str | None = None

        def abandon(reason: str) -> None:
            nonlocal candidate, expected_length, last_problem
            if candidate is None:
                return
            last_problem = reason
            window[:] = candidate[-3:]
            candidate = None
            expected_length = None

        while inspected < FLASH_RESPONSE_SCAN_LIMIT:
            byte_deadline = deadline
            if candidate is not None:
                byte_deadline = min(
                    deadline,
                    time.monotonic() + FLASH_RESPONSE_CANDIDATE_GAP_SECONDS,
                )
            try:
                byte = self._read_exact_until(
                    1,
                    byte_deadline,
                    (
                        "case bridge response candidate byte"
                        if candidate is not None
                        else "case bridge response synchronization byte"
                    ),
                )[0]
            except TransportTimeout:
                if candidate is not None:
                    abandon(
                        f"cached candidate stopped after {len(candidate)} bytes"
                    )
                    continue
                if last_problem is not None:
                    break
                raise
            inspected += 1

            if candidate is None:
                window.append(byte)
                if len(window) > 4:
                    del window[0]
                if window == b"G2RX":
                    discarded = inspected - 4
                    candidate = bytearray(window)
                continue

            candidate.append(byte)
            if len(candidate) > 4 and candidate[-4:] == b"G2RX":
                last_problem = (
                    f"cached candidate stopped after {len(candidate) - 4} bytes"
                )
                candidate = bytearray(b"G2RX")
                expected_length = None
                continue
            if len(candidate) == 11:
                if candidate[4] != 1:
                    abandon(f"unsupported response version {candidate[4]}")
                    continue
                if candidate[5] != self.sequence:
                    abandon(
                        f"stale response sequence {candidate[5]}, "
                        f"expected {self.sequence}"
                    )
                    continue
                if candidate[8] > max_capture_bytes:
                    abandon(
                        f"capture length {candidate[8]} exceeds "
                        f"{max_capture_bytes}"
                    )
                    continue
                expected_length = 11 + candidate[8] + 1
            if expected_length is not None and len(candidate) == expected_length:
                response = bytes(candidate)
                if response[-1] != sum(response[:-1]) & 0xFF:
                    abandon("response checksum is invalid")
                    continue
                if discarded:
                    print(
                        "case bridge: discarded "
                        f"{discarded} short-response prefix bytes and "
                        "synchronized to a complete G2RX frame",
                        flush=True,
                    )
                return response[6], response[7], response[11:-1]

        detail = f"; last candidate: {last_problem}" if last_problem else ""
        raise ProtocolError(
            "case bridge emitted "
            f"{inspected} bytes without a complete checksum-valid G2RX frame"
            f"{detail}"
        )

    def _read_header_flow_token(self, deadline: float) -> None:
        """Wait for C3 while safely consuming late cached G2RX frames.

        The SRAM bridge retransmits its cached response when the CH340 host
        path was short. A checksum-valid version response can therefore be
        followed by another copy that arrives after the next transaction
        header. That cached frame must not be mistaken for the header token.
        """
        if self.port is None:
            raise ProtocolError("case bridge is not open")
        window = bytearray()
        inspected = 0
        cached_frames = 0
        while inspected < FLASH_RESPONSE_SCAN_LIMIT:
            byte = self._read_exact_until(
                1, deadline, "transaction-header flow-control stream"
            )[0]
            inspected += 1
            if byte == 0xC3 and not window:
                if cached_frames:
                    print(
                        "case bridge: discarded "
                        f"{cached_frames} late checksum-valid cached G2RX "
                        "frame(s) before the transaction-header token",
                        flush=True,
                    )
                return
            window.append(byte)
            if len(window) > 4:
                del window[0]
            if window != b"G2RX":
                continue
            suffix = self._read_exact_until(
                7, deadline, "late cached G2RX header suffix"
            )
            inspected += 7
            header = b"G2RX" + suffix
            if header[4] != 1 or header[8] > 64:
                raise ProtocolError(
                    "late cached G2RX header is invalid: " + header.hex()
                )
            tail = self._read_exact_until(
                header[8] + 1,
                deadline,
                "late cached G2RX payload/checksum",
            )
            inspected += len(tail)
            frame = header + tail
            if frame[-1] != sum(frame[:-1]) & 0xFF:
                raise ProtocolError(
                    "late cached G2RX response checksum is invalid"
                )
            cached_frames += 1
            window.clear()
        raise ProtocolError(
            "case bridge emitted "
            f"{inspected} bytes without transaction-header token c3"
        )

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
        self._write_host_header(bytes(header))
        deadline = time.monotonic() + 8.0
        self._read_header_flow_token(deadline)
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
        self._write_host_header(bytes(header))
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
                host_timeout_restored = (
                    words[4] == 16
                    and words[1] == 3
                    and words[5] == 0x3FF
                    and words[6] == 0x3FF
                    and words[7] == 0x3FF
                    and words[15] == 0
                    and self.baseline in ALLOWED_YHM_BASELINES
                    and self.baseline == self.restored
                )
                diagnostic_failure_restored = (
                    self.sbl_hello_probe and words[4] in (2, 5, 6)
                )
                zero_write_setup_stop = (
                    words[4] == 3
                    and words[5] == 0x3FF
                    and words[6] == 0
                    and words[7] == 0
                    and words[8] == 0
                    and words[13] == 0
                    and words[14] == 0
                    and words[15] == 0
                    and words[30] == 0
                    and words[31] == 0
                    and self.restored == bytes(10)
                )
                if (
                    proof != PROOF
                    or words[0] != 0x57463247
                    or words[1] != 3
                    or words[2] != expected_route
                    or (
                        not host_timeout_restored
                        and not zero_write_setup_stop
                        and words[3] != self.sequence
                    )
                    or (
                        words[4] not in (0, 16)
                        and not diagnostic_failure_restored
                        and not zero_write_setup_stop
                    )
                    or words[5] != 0x3FF
                    or (
                        not zero_write_setup_stop
                        and words[6] != 0x3FF
                    )
                    or (
                        not zero_write_setup_stop
                        and words[7] != 0x3FF
                    )
                    or words[15] != 0
                    or (
                        not zero_write_setup_stop
                        and self.baseline not in ALLOWED_YHM_BASELINES
                    )
                    or (
                        not host_timeout_restored
                        and
                        self.completed_transfer is not None
                        and (
                            words[11] != self.completed_transfer[0]
                            or words[12] != self.completed_transfer[0]
                            or words[10] != self.completed_transfer[1]
                        )
                    )
                    or (
                        not zero_write_setup_stop
                        and self.baseline != self.restored
                    )
                ):
                    raise SafetyError(
                        "case bridge restore proof is incomplete or belongs "
                        "to another transaction: "
                        f"retained={self.retained_result}, "
                        f"baseline={self.baseline.hex()}, "
                        f"restored={self.restored.hex()}"
                    )
                if host_timeout_restored:
                    self.retained_result[
                        "host_timeout_restoration_verified"
                    ] = True
                if diagnostic_failure_restored:
                    self.retained_result[
                        "diagnostic_failure_restoration_verified"
                    ] = True
                if zero_write_setup_stop:
                    self.retained_result[
                        "zero_write_setup_stop_verified"
                    ] = True
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
        exit_error: Exception | None = None
        if self.active and self.port is not None and self.port.is_open:
            try:
                self.restored = self._request_exit()
            except Exception as error:
                exit_error = error
            finally:
                self.active = False
                self.port.close()
                self.port = None
        time.sleep(0.35)
        try:
            self._verify_retained_restore()
        except Exception as error:
            errors.append(f"retained restore proof: {error}")
        if exit_error is not None and not self.restore_verified:
            errors.append(f"exit request: {exit_error}")
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


def reset_for_sbl_hello_window(device: str) -> dict[str, object]:
    """Issue one traced bilateral reset and return as soon as B0 is confirmed."""
    port = _open_case_console(device)
    try:
        # Opening the console resets the Case MCU.  Perform the presence check
        # and DEB0 in this same session: reopening here would send DEB0 during
        # the Case boot banner and can silently miss the command.
        preflight_capture = bytearray(_drain_case_console(port, 2.5))
        port.reset_input_buffer()
        if port.write(b"DEA3\n") != 5:
            raise ProtocolError("case telemetry query was truncated")
        port.flush()
        preflight_capture.extend(_drain_case_console(port, 1.0))
        preflight = parse_case_restore_evidence(
            bytes(preflight_capture),
            require_reset_confirmation=False,
        )
        if not preflight["right_present"]:
            raise SafetyError(
                "fresh case telemetry does not report right as seated"
            )

        port.reset_input_buffer()
        if port.write(FINAL_RESET_COMMAND) != len(FINAL_RESET_COMMAND):
            raise ProtocolError("case SBL-window reset command was truncated")
        port.flush()
        deadline = time.monotonic() + 0.8
        captured = bytearray()
        while time.monotonic() < deadline:
            captured.extend(port.read(4096))
            if FINAL_RESET_CONFIRMATION.search(captured):
                break
        if not FINAL_RESET_CONFIRMATION.search(captured):
            raise SafetyError(
                "case did not confirm the single SBL-window bilateral reset"
            )
    finally:
        port.close()
    return {
        "case_version": preflight["case_version"],
        "left_present": preflight["left_present"],
        "right_present": preflight["right_present"],
        "reset_command": FINAL_RESET_COMMAND.decode("ascii").strip(),
        "reset_confirmed": True,
        "confirmation_hex": bytes(captured).hex(),
    }


def probe_right_apollo_sbl(
    device: str,
    *,
    observed_charging_phase: bool = False,
) -> dict[str, object]:
    """Send exactly one read-only Ambiq wired HELLO to the seated right route."""
    reset_report = reset_for_sbl_hello_window(device)
    transport: CaseSramTempleTransport | None = None
    primary_error: Exception | None = None
    try:
        transport = CaseSramTempleTransport(
            device,
            "right",
            observed_charging_phase=observed_charging_phase,
            sbl_hello_probe=True,
        )
        captured = transport.transact(SBL_HELLO_REQUEST, timeout=12.0)
        status = parse_sbl_status_response(captured)
        return {
            "outcome": "apollo_sbl_status_verified",
            "route": "right",
            "request_hex": SBL_HELLO_REQUEST.hex(),
            "request_sha256": hashlib.sha256(SBL_HELLO_REQUEST).hexdigest(),
            "bridge_sha256": hashlib.sha256(transport.payload).hexdigest(),
            "reset": reset_report,
            "status": status,
        }
    except Exception as error:
        primary_error = error
        raise
    finally:
        if transport is not None:
            try:
                _close_checked(transport)
            except Exception as close_error:
                if primary_error is None:
                    raise
                raise SafetyError(
                    f"SBL HELLO probe failed: {primary_error}; "
                    f"case/YHM cleanup also failed: {close_error}"
                ) from primary_error


def final_reset_and_verify_liveness(
    device: str,
    routes: tuple[str, ...],
    expected_version: str,
    *,
    observed_charging_phase: bool = False,
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
        version = None
        for phase_attempt in range(1, 5):
            transport: CaseSramTempleTransport | None = None
            try:
                transport = CaseSramTempleTransport(
                    device,
                    route,
                    observed_charging_phase=observed_charging_phase,
                )
                version = MainFirmwareFlasher(transport).read_version()
                break
            except SafetyError as error:
                if (
                    "bridge setup status 3:" not in str(error)
                    or phase_attempt == 4
                ):
                    raise
                time.sleep(0.5 * phase_attempt)
            finally:
                if transport is not None:
                    _close_checked(transport)
        if version is None:
            raise SafetyError(
                f"{route}: post-reset version retry ended without a result"
            )
        if version.firmware != expected_version or version.hardware != 5:
            raise SafetyError(
                f"{route}: post-reset expected {expected_version}/hardware 5, "
                f"observed {version.firmware}/hardware {version.hardware}"
            )
        versions[route] = asdict(version)
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


def classify_zero_byte_start_boundary(
    error: Exception,
    retained_result: dict[str, object],
) -> dict[str, object] | None:
    """Recognize the interrupted-session START failure proven on 2026-07-25."""
    if (
        not isinstance(error, NonIdempotentOtaError)
        or error.command != 0x52
        or "no complete temple frame" not in str(error)
        or retained_result.get("declared_size") != 0
        or retained_result.get("accepted_size") != 0
    ):
        return None
    return {
        "classification": "wired_start_no_frame_zero_byte_boundary",
        "firmware_bytes_accepted": 0,
        "start_or_header_replay_allowed": False,
        "recommended_next_transport": (
            "fresh BLE full-package session if the temple advertises"
        ),
        "recovery_recommendation": error.recovery_recommendation,
    }


def verify_route_stability(
    flasher: MainFirmwareFlasher,
    expected_version: str,
    expected_hardware: int,
    *,
    queries: int = FLASH_STABILITY_QUERIES,
    interval_seconds: float = FLASH_STABILITY_INTERVAL_SECONDS,
    sleeper=time.sleep,
) -> dict[str, object]:
    """Account for the fresh preflight reply and optionally repeat it."""
    if queries < 1:
        raise ValueError("liveness preflight requires at least one query")
    for index in range(2, queries + 1):
        if interval_seconds:
            sleeper(interval_seconds)
        try:
            observed = flasher.read_version()
        except FlasherError as error:
            raise ProtocolError(
                f"stability query {index}/{queries}: {error}"
            ) from error
        if (
            observed.firmware != expected_version
            or observed.hardware != expected_hardware
        ):
            raise SafetyError(
                f"stability query {index}/{queries}: expected "
                f"{expected_version}/hardware {expected_hardware}, observed "
                f"{observed.firmware}/hardware {observed.hardware}"
            )
    return {
        "queries": queries,
        "interval_ms": interval_seconds * 1_000.0,
        "firmware": expected_version,
        "hardware": expected_hardware,
        "outcome": "success",
    }


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


def load_recent_reset_proof(
    path: Path,
    *,
    device: str,
    accepted_versions: set[str],
) -> dict[str, object]:
    """Validate a fresh bilateral DEB0/version proof for a zero-query START."""
    try:
        proof = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SafetyError(f"cannot read recent reset proof {path}: {error}") from error
    if proof.get("schema_version") != 1 or proof.get("operation") != (
        "g2_case_usb_bilateral_reset_proof"
    ):
        raise SafetyError("recent reset proof has the wrong schema or operation")
    if proof.get("device") != device:
        raise SafetyError("recent reset proof belongs to a different USB device")
    try:
        created = datetime.fromisoformat(str(proof["created_at_utc"]))
    except (KeyError, ValueError) as error:
        raise SafetyError("recent reset proof timestamp is invalid") from error
    if created.tzinfo is None:
        raise SafetyError("recent reset proof timestamp lacks a timezone")
    age = (datetime.now(timezone.utc) - created).total_seconds()
    if age < -5.0 or age > RECENT_RESET_PROOF_MAX_AGE_SECONDS:
        raise SafetyError(
            f"recent reset proof age {age:.1f}s is outside the "
            f"0..{RECENT_RESET_PROOF_MAX_AGE_SECONDS:.0f}s window"
        )
    report = proof.get("report")
    if not isinstance(report, dict) or report.get("outcome") != "success":
        raise SafetyError("recent reset proof does not record reset success")
    case = report.get("case")
    if (
        not isinstance(case, dict)
        or case.get("case_version") != REVIEWED_CASE_VERSION
        or case.get("reset_confirmed") is not True
        or case.get("left_present") is not True
        or case.get("right_present") is not True
    ):
        raise SafetyError("recent reset proof lacks bilateral Case/contact evidence")
    versions = report.get("versions")
    if not isinstance(versions, dict):
        raise SafetyError("recent reset proof lacks bilateral versions")
    for route in ("left", "right"):
        observed = versions.get(route)
        if (
            not isinstance(observed, dict)
            or observed.get("firmware") not in accepted_versions
            or observed.get("hardware") != 5
        ):
            raise SafetyError(
                f"recent reset proof has an invalid {route} identity"
            )
    proof["validated_age_seconds"] = age
    return proof


def resolve_pacing_profile(
    name: str,
    *,
    accept_experimental_risk: bool,
) -> dict[str, object]:
    profile = PACING_PROFILES[name]
    if not profile["hardware_qualified"] and not accept_experimental_risk:
        raise ValueError(
            f"pacing profile {name!r} is not hardware-qualified; "
            "pass --accept-experimental-pacing-risk to use it"
        )
    return dict(profile)


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
    preflight.add_argument(
        "--observed-2-2-9-charging-phase",
        action="store_true",
        help=(
            "use the separately hash-pinned bridge table for the observed "
            "Case 1.2.57 YHM ...33ff charging phase"
        ),
    )

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
    host_stress.add_argument(
        "--observed-2-2-9-charging-phase",
        action="store_true",
        help=(
            "use the separately hash-pinned bridge table for the observed "
            "Case 1.2.57 YHM ...33ff charging phase"
        ),
    )

    reset = subparsers.add_parser(
        "reset-both-temples",
        help=(
            "send the traced DEB0 bilateral reset, reopen the Case console, "
            "and verify both running temples"
        ),
    )
    reset.add_argument("--device", required=True)
    reset.add_argument("--expect-version", default=REVIEWED_BASE_VERSION)
    reset.add_argument("--glasses-seated-confirmed", action="store_true")
    reset.add_argument(
        "--log",
        type=Path,
        help="write a timestamped bilateral proof usable for a zero-query START",
    )
    reset.add_argument(
        "--observed-2-2-9-charging-phase",
        action="store_true",
        help=(
            "use the separately hash-pinned bridge table for post-reset "
            "liveness when Case 1.2.57 reports the YHM ...33ff charging phase"
        ),
    )

    sbl_probe = subparsers.add_parser(
        "probe-apollo-sbl-right",
        help=(
            "issue one traced bilateral reset, then send only the exact "
            "read-only Apollo wired HELLO on the seated right route"
        ),
    )
    sbl_probe.add_argument("--device", required=True)
    sbl_probe.add_argument("--glasses-seated-confirmed", action="store_true")
    sbl_probe.add_argument(
        "--execute-bounded-reset-and-hello",
        action="store_true",
        help="confirm the single reset and exact eight-byte SBL HELLO",
    )
    sbl_probe.add_argument("--log", type=Path, required=True)
    sbl_probe.add_argument(
        "--observed-2-2-9-charging-phase",
        action="store_true",
        help=(
            "use the separately hash-pinned bridge table for the observed "
            "Case 1.2.57 YHM ...33ff charging phase"
        ),
    )

    for command, help_text in (
        (
            "flash-reviewed-cfw",
            "flash the exact reviewed CFW Apollo-main image",
        ),
        (
            "flash-reviewed-official",
            "restore the exact pinned official Apollo-main image",
        ),
        (
            "flash-candidate-cfw-2.2.9.28",
            "flash the latest-upstream-pinned 2.2.9.28 CFW candidate",
        ),
        (
            "flash-opencfw-2.2.6.0",
            "flash the exact source-built openCFW 2.2.6.0 Apollo-main image",
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
            "--recent-reset-proof",
            type=Path,
            help=(
                "use a <=120-second bilateral DEB0/version proof instead of "
                "spending the selected route window on another version query"
            ),
        )
        flash.add_argument(
            "--expect-current-version",
            default=None,
            help=(
                "override the live source-version gate; defaults are selected "
                "from the exact pinned image profile"
            ),
        )
        flash.add_argument(
            "--pacing-profile",
            choices=tuple(PACING_PROFILES),
            default="conservative",
            help=(
                "storage pacing profile; conservative is hardware-qualified "
                "(default: conservative)"
            ),
        )
        flash.add_argument(
            "--accept-experimental-pacing-risk",
            action="store_true",
            help="required for a pacing profile that is not hardware-qualified",
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

    if args.command == "probe-apollo-sbl-right":
        if not args.execute_bounded_reset_and_hello:
            parser.error(
                "SBL probing requires --execute-bounded-reset-and-hello"
            )
        audit: dict[str, object] = {
            "schema_version": 1,
            "operation": "g2_case_usb_right_apollo_sbl_hello_probe",
            "created_at_utc": datetime.now(timezone.utc).isoformat(),
            "device": args.device,
            "route": "right",
            "temple_write_bytes": 0,
            "sbl_request_bytes_allowed": len(SBL_HELLO_REQUEST),
        }
        try:
            report = probe_right_apollo_sbl(
                args.device,
                observed_charging_phase=(
                    args.observed_2_2_9_charging_phase
                ),
            )
            audit["outcome"] = "success"
            audit["report"] = report
            _write_audit(args.log, audit)
            print(json.dumps(report, indent=2, sort_keys=True))
            return 0
        except (
            OSError,
            FlasherError,
            BootloaderError,
            serial.SerialException,
        ) as error:
            audit["outcome"] = "failed_safely"
            audit["error"] = str(error)
            _write_audit(args.log, audit)
            print(f"Apollo SBL HELLO probe failed safely: {error}", file=sys.stderr)
            return 1

    if args.command == "reset-both-temples":
        try:
            report = final_reset_and_verify_liveness(
                args.device,
                ("right", "left"),
                args.expect_version,
                observed_charging_phase=args.observed_2_2_9_charging_phase,
            )
            if args.log is not None:
                _write_audit(
                    args.log,
                    {
                        "schema_version": 1,
                        "operation": "g2_case_usb_bilateral_reset_proof",
                        "created_at_utc": datetime.now(timezone.utc).isoformat(),
                        "device": args.device,
                        "expected_version": args.expect_version,
                        "report": report,
                    },
                )
            print(json.dumps(report, indent=2, sort_keys=True))
            return 0
        except (
            OSError,
            FlasherError,
            BootloaderError,
            serial.SerialException,
        ) as error:
            print(
                f"Bilateral reset was not fully verified: {error}",
                file=sys.stderr,
            )
            return 1

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
            transport = CaseSramTempleTransport(
                args.device,
                args.route,
                observed_charging_phase=args.observed_2_2_9_charging_phase,
            )
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
            transport = CaseSramTempleTransport(
                args.device,
                args.route,
                observed_charging_phase=(
                    args.command == "preflight"
                    and args.observed_2_2_9_charging_phase
                ),
            )
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
        "flash-candidate-cfw-2.2.9.28",
        "flash-opencfw-2.2.6.0",
    )
    if args.command == "flash-reviewed-cfw":
        image_kind = "CFW"
        pinned_sha256 = REVIEWED_CFW_SHA256
        pinned_main_sha256 = REVIEWED_MAIN_SHA256
        pinned_main_bytes = REVIEWED_MAIN_BYTES
        default_source_versions = {REVIEWED_BASE_VERSION}
    elif args.command == "flash-candidate-cfw-2.2.9.28":
        image_kind = "CFW candidate"
        pinned_sha256 = CFW_2_2_9_CANDIDATE_SHA256
        pinned_main_sha256 = CFW_2_2_9_CANDIDATE_MAIN_SHA256
        pinned_main_bytes = CFW_2_2_9_CANDIDATE_MAIN_BYTES
        default_source_versions = set(CFW_2_2_9_CANDIDATE_SOURCE_VERSIONS)
    elif args.command == "flash-opencfw-2.2.6.0":
        image_kind = "openCFW 2.2.6.0"
        pinned_sha256 = OPENCFW_2_2_6_RELEASE_SHA256
        pinned_main_sha256 = OPENCFW_2_2_6_RELEASE_MAIN_SHA256
        pinned_main_bytes = OPENCFW_2_2_6_RELEASE_MAIN_BYTES
        default_source_versions = {
            REVIEWED_BASE_VERSION,
            OPENCFW_2_2_6_RELEASE_VERSION,
        }
    else:
        image_kind = "official"
        pinned_sha256 = REVIEWED_OFFICIAL_SHA256
        pinned_main_sha256 = REVIEWED_OFFICIAL_MAIN_SHA256
        pinned_main_bytes = REVIEWED_OFFICIAL_MAIN_BYTES
        default_source_versions = {
            REVIEWED_BASE_VERSION,
            REVIEWED_CFW_VERSION,
        }
    is_cfw = image_kind != "official"
    uses_observed_charging_bridge = (
        args.command == "flash-candidate-cfw-2.2.9.28"
    )
    active_bridge_sha256 = (
        OBSERVED_CHARGING_BRIDGE_SHA256
        if uses_observed_charging_bridge
        else BRIDGE_SHA256
    )
    expected_current_versions = (
        {args.expect_current_version}
        if args.expect_current_version
        else default_source_versions
    )
    recent_reset_proof = None
    if args.recent_reset_proof is not None:
        try:
            recent_reset_proof = load_recent_reset_proof(
                args.recent_reset_proof,
                device=args.device,
                accepted_versions=expected_current_versions,
            )
        except SafetyError as error:
            parser.error(str(error))
    if not args.execute_main_ota:
        parser.error("flash requires --execute-main-ota")
    if not args.accept_single_slot_risk:
        parser.error("flash requires --accept-single-slot-risk")
    try:
        pacing = resolve_pacing_profile(
            args.pacing_profile,
            accept_experimental_risk=args.accept_experimental_pacing_risk,
        )
    except ValueError as error:
        parser.error(str(error))
    try:
        plan, component = build_package_plan(args.image)
    except (OSError, FlasherError, ValueError) as error:
        print(f"Package validation failed: {error}", file=sys.stderr)
        return 1
    if plan.image_sha256 != pinned_sha256:
        parser.error(
            "this case bridge command accepts only the pinned "
            + image_kind
            + " image "
            + pinned_sha256
        )
    if (
        plan.main_payload_bytes != pinned_main_bytes
        or plan.main_payload_sha256 != pinned_main_sha256
    ):
        parser.error(
            "the Apollo-main component does not match the pinned "
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
        "schema_version": 3,
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "operation": (
            "g2_case_usb_"
            + image_kind.lower().replace(" ", "_")
            + "_main_only"
        ),
        "device": args.device,
        "routes": routes,
        "package": asdict(plan),
        "installed_identity": {
            "channel": "custom" if is_cfw else "official",
            "reported_version": plan.expected_device_version,
            "display_version": (
                f"{plan.expected_device_version} CFW"
                if is_cfw
                else plan.expected_device_version
            ),
            "exact_image_sha256": plan.image_sha256,
            "evidence": (
                "exact image pins, accepted transfer counts, postflight, "
                "final bilateral reset, and liveness"
            ),
        },
        "accepted_source_versions": sorted(expected_current_versions),
        "pacing_profile": {
            "name": args.pacing_profile,
            **pacing,
        },
        "bridge_sha256": active_bridge_sha256,
        "bridge_yhm_profile": (
            "observed-2.2.9-charging-33ff"
            if uses_observed_charging_bridge
            else "hardware-qualified-idle-22ff"
        ),
        "bootloader_component_allowed": False,
        "data_replay_allowed": False,
        "component_attempts_per_invocation": 1,
        "component_restart_boundary": (
            "new invocation after verified cleanup and final bilateral reset"
        ),
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
                for phase_attempt in range(1, 5):
                    print(
                        f"{route}: loading verified volatile case bridge "
                        f"(route-phase attempt {phase_attempt}/4)",
                        flush=True,
                    )
                    try:
                        transport = CaseSramTempleTransport(
                            args.device,
                            route,
                            require_route_phase=True,
                            observed_charging_phase=(
                                uses_observed_charging_bridge
                            ),
                        )
                        route_result["route_phase_setup_attempts"] = (
                            phase_attempt
                        )
                        break
                    except SafetyError as error:
                        if (
                            "bridge setup status 3:" not in str(error)
                            or phase_attempt == 4
                        ):
                            raise
                        print(
                            f"{route}: Case idle phase does not match the "
                            "selected mutation route; retrying before any "
                            "temple transmission",
                            flush=True,
                        )
                        settle_seconds = ROUTE_PHASE_SETTLE_SECONDS[
                            phase_attempt - 1
                        ]
                        print(
                            f"{route}: leaving the normal Case application "
                            f"undisturbed for {settle_seconds:.0f} seconds "
                            "before the next fresh setup",
                            flush=True,
                        )
                        time.sleep(settle_seconds)
                assert transport is not None
                flasher = MainFirmwareFlasher(
                    transport,
                    response_timeout=8.0,
                    finish_timeout=60.0,
                    data_retries=0,
                    retry_backoff_seconds=30.0,
                    deferred_batch_size=int(pacing["deferred_batch_size"]),
                    batch_settle_seconds=float(
                        pacing["batch_settle_seconds"]
                    ),
                    late_batch_settle_seconds=float(
                        pacing["late_batch_settle_seconds"]
                    ),
                    late_batch_threshold=float(
                        pacing["late_batch_threshold"]
                    ),
                    final_settle_seconds=float(
                        pacing["final_settle_seconds"]
                    ),
                    progress=_progress(route),
                )
                if recent_reset_proof is not None:
                    # Route-phase retries may wait up to several minutes.  A
                    # proof that was fresh during argument validation must
                    # still be fresh immediately before the first mutating
                    # temple request.
                    assert args.recent_reset_proof is not None
                    recent_reset_proof = load_recent_reset_proof(
                        args.recent_reset_proof,
                        device=args.device,
                        accepted_versions=expected_current_versions,
                    )
                    proof_report = recent_reset_proof["report"]
                    assert isinstance(proof_report, dict)
                    proof_versions = proof_report["versions"]
                    assert isinstance(proof_versions, dict)
                    observed = proof_versions[route]
                    assert isinstance(observed, dict)
                    current_firmware = str(observed["firmware"])
                    current_hardware = int(observed["hardware"])
                    route_result["preflight_version"] = dict(observed)
                    route_result["preflight_version_source"] = (
                        "recent bilateral DEB0 proof; zero selected-route queries"
                    )
                    route_result["recent_reset_proof"] = {
                        "path": str(args.recent_reset_proof),
                        "created_at_utc": recent_reset_proof["created_at_utc"],
                        "validated_age_seconds": recent_reset_proof[
                            "validated_age_seconds"
                        ],
                    }
                else:
                    current = flasher.read_version()
                    current_firmware = current.firmware
                    current_hardware = current.hardware
                    route_result["preflight_version"] = asdict(current)
                    route_result["preflight_version_source"] = (
                        "just-in-time selected-route query"
                    )
                print(
                    f"{route}: preflight firmware={current_firmware}, "
                    f"hardware={current_hardware}",
                    flush=True,
                )
                if current_firmware not in expected_current_versions:
                    raise SafetyError(
                        f"{route}: expected source firmware in "
                        f"{sorted(expected_current_versions)}, observed "
                        f"{current_firmware}"
                    )
                if current_hardware != 5:
                    raise SafetyError(
                        f"{route}: expected hardware 5, "
                        f"observed {current_hardware}"
                    )
                # The product-test route has a short elapsed app-mode window.
                # Hardware proved that repeated liveness queries consume that
                # window: START failed after the old gate but the identical
                # START acknowledged after one fresh version query. The query
                # above is therefore the entire just-in-time gate. Do not add
                # a second query, settle, or host-only prime before START.
                route_result["stability_preflight"] = {
                    "outcome": "success",
                    "queries": 0 if recent_reset_proof is not None else 1,
                    "interval_ms": 0.0,
                    "firmware": current_firmware,
                    "hardware": current_hardware,
                    "source": route_result["preflight_version_source"],
                }
                print(
                    f"{route}: identity gate complete with "
                    f"{route_result['stability_preflight']['queries']} "
                    "selected-route queries",
                    flush=True,
                )
                # The bridge can retransmit a cached G2RX frame after the host
                # has already accepted the checksum-valid version response.
                # Discard only those host-side leftovers immediately; this is
                # not a temple transaction and adds no route-window delay.
                if recent_reset_proof is None:
                    transport.drain_input()
                route_result["pre_start_input_drain"] = {
                    "host_only": True,
                    "temple_transmission": False,
                    "delay_seconds": 0.0,
                }
                print(
                    f"{route}: starting pinned {image_kind} "
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
                if args.command == "flash-candidate-cfw-2.2.9.28":
                    # On 2.2.9 hardware, FINISH commits the new main but the
                    # running application continues to report the old version
                    # until DEB0.  Treat the final bilateral activation reset
                    # and checksum-valid version query as the postflight gate.
                    route_result["postflight_version"] = {
                        "deferred_until_activation_reset": True,
                        "reason": "2.2.9 activates the committed main after DEB0",
                    }
                else:
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
                    if isinstance(route_error, NonIdempotentOtaError):
                        route_result["failure_stage"] = route_error.stage
                        route_result["failed_command"] = (
                            f"0x{route_error.command:02x}"
                        )
                        route_result["recovery_recommendation"] = (
                            route_error.recovery_recommendation
                        )
                    recovery_boundary = classify_zero_byte_start_boundary(
                        route_error,
                        route_result.get("retained_result", {}),
                    )
                    if recovery_boundary is not None:
                        route_result["recovery_boundary"] = recovery_boundary
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
            observed_charging_phase=uses_observed_charging_bridge,
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
        for route_result in reversed(route_results):
            if "recovery_boundary" in route_result:
                audit["recovery_boundary"] = route_result["recovery_boundary"]
                break
            if "recovery_recommendation" in route_result:
                audit["recovery_recommendation"] = (
                    route_result["recovery_recommendation"]
                )
                break
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
                        observed_charging_phase=(
                            uses_observed_charging_bridge
                        ),
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
