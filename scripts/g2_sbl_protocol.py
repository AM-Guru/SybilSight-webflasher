"""Read-only Apollo5 SBL discovery framing.

Layout: AmbiqSuite 5.2.0 tools/apollo510_scripts/uart_wired_update.py,
connect_device(): HELLO is 8 bytes and STATUS is 96 bytes. No update,
recovery, abort, reset, descriptor or data command is implemented here.
"""
from __future__ import annotations

import struct
import zlib

STATUS_BYTES = 96
HELLO = bytes.fromhex("14559de900000800")
ENTRY_BIASES = {"none": (0, 0), "pb8-low": (8, 0), "pb8-high": (8, 1), "pb9-low": (9, 0), "pb9-high": (9, 1)}
BIAS_HOLD_MS = 5000


def bias_configuration(name: str) -> dict | None:
    pin, level = ENTRY_BIASES[name]
    return None if not pin else {
        "casePin": pin, "candidateApolloGpio": 44 if pin == 8 else 42,
        "level": level, "drive": "input-pull", "holdMs": BIAS_HOLD_MS,
        "triggerContext": "operator-timed-depleted-insertion",
    }


def bias_word(manifest: dict) -> int:
    bias = manifest.get("entryBias")
    return 0 if bias is None else 0x80000000 | bias["casePin"] | (bias["level"] << 8)


def ready_frame_bytes(manifest: dict) -> int:
    return 32 if manifest.get("entryBias") else 24


def parse_ready_frame(frame: bytes, manifest: dict) -> dict:
    """Validate the Case bridge's post-routing acknowledgement, not SBL."""
    length = ready_frame_bytes(manifest)
    if len(frame) != length:
        raise ValueError(f"Case readiness frame must contain {length} bytes")
    words = struct.unpack(f"<{length // 4}I", frame)
    profiles = {"reviewed-22":0, "observed-33":1, "observed-33-entry1":2, "observed-45":3}
    identity = (2 if manifest.get("entryBias") else 1) | ((0 if manifest["route"] == "left" else 1) << 8) | (profiles[manifest["profile"]] << 16)
    expected = (0x42533247, identity, 64 if manifest["nominalBaud"] == 1000000 else 556, manifest["attempts"], manifest["receiveIntervalMs"])
    if manifest.get("entryBias"):
        expected += (bias_word(manifest), manifest["entryBias"]["holdMs"])
    if words[:-1] != expected or zlib.crc32(frame[:-4]) & 0xffffffff != words[-1]:
        raise ValueError("Case readiness CRC or executed configuration differs")
    return {"route":manifest["route"], "nominalBaud":manifest["nominalBaud"], "profile":manifest["profile"], "attempts":words[3], "receiveIntervalMs":words[4], "entryBias":manifest.get("entryBias"), "frameHex":frame.hex()}


def find_status_frames(capture: bytes) -> list[dict[str, object]]:
    """Find complete CRC-valid STATUS frames without deleting echo bytes.

    The old 'foreign byte' filter discarded values also occurring in HELLO,
    including zero. Those values are legitimate STATUS data. Keep all bytes
    and resynchronize at every offset, including after bad/truncated headers.
    A reply proves a responding protocol endpoint, not image authorization.
    """
    if len(capture) > 1_048_576:
        raise ValueError("capture exceeds the 1 MiB offline analysis limit")
    frames = []
    for offset in range(max(0, len(capture) - STATUS_BYTES + 1)):
        if capture[offset + 4:offset + 8] != b"\x01\x00\x60\x00":
            continue
        frame = capture[offset:offset + STATUS_BYTES]
        crc, = struct.unpack_from("<I", frame)
        if zlib.crc32(frame[4:]) & 0xffffffff != crc:
            continue
        words = struct.unpack("<24I", frame)
        version = words[2]
        # Ambiq's v1.0 layout swaps the revision/security-debug slots.
        legacy = version == 0xffff0100
        frames.append({
            "offset": offset,
            "length": STATUS_BYTES,
            "crc32": f"{crc:08x}",
            "sblVersionRaw": f"{version:08x}",
            "sblVersion": f"{(version >> 8) & 255}.{version & 255}",
            "maxStorage": words[3],
            "status": words[4],
            "state": words[5],
            "chipId": [f"{value:08x}" for value in words[6:8]],
            "chipRevision": None if legacy else words[9],
            "securityDebugCertificate": words[9] if legacy else words[8],
            "socIdHex": frame[40:72].hex(),
            "amInfoHex": frame[72:96].hex(),
            "frameHex": frame.hex(),
            "firmwareWriteAuthorized": False,
        })
    return frames


def classify_capture(capture: bytes, *, reset_evidence: str = "unknown") -> dict[str, object]:
    if reset_evidence not in {"unknown", "operator-reported-depleted-insertion", "instrument-confirmed"}:
        raise ValueError("unsupported reset evidence")
    frames = find_status_frames(capture)
    return {
        "state": "sbl-status-verified" if frames else "no-valid-sbl-status-captured",
        "captureBytes": len(capture),
        "statusFrames": frames,
        "resetEvidence": reset_evidence,
        "physicalResetVerified": reset_evidence == "instrument-confirmed",
        "firmwareWriteAuthorized": False,
        "interpretation": (
            "A CRC-valid SBL STATUS was captured. Provisioning, route identity and accepted recovery image still need validation."
            if frames else
            "No complete CRC-valid STATUS was captured in this window. This does not establish that USB recovery is unavailable."
        ),
    }
