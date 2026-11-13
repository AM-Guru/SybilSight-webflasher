"""Classify exact Even bootloader EasyLogger markers in a bounded UART capture."""

from __future__ import annotations


BOOT_BANNER = b">>> Even Bootloader start <<<"
OTA_FLAG_PREFIX = b"otaFlag = 0x"
UPDATE_DECISION = b"need updata firmware"
APP_DECISION = b"DO NOT need updata firmware, GO TO APP"


def classify_even_bootloader_log(raw: bytes) -> dict:
    """Return exact-marker evidence without inferring execution from silence."""
    if not isinstance(raw, bytes):
        raise TypeError("bootloader capture must be bytes")
    banner = BOOT_BANNER in raw
    ota_flag = OTA_FLAG_PREFIX in raw
    update = UPDATE_DECISION in raw and APP_DECISION not in raw
    app = APP_DECISION in raw
    conflict = update and app
    if conflict:
        decision = "conflicting-markers"
    elif app:
        decision = "go-to-app"
    elif update:
        decision = "install-staged-image"
    else:
        decision = None
    observed = banner or ota_flag or update or app
    return {
        "evenBootloaderLogObserved": observed,
        "bootBannerObserved": banner,
        "otaFlagLogObserved": ota_flag,
        "managerDecision": decision,
        "conflictingDecisionMarkers": conflict,
        "captureBytes": len(raw),
        "proofBoundary": (
            "Exact ASCII markers prove only that bytes matching the reconstructed "
            "Even bootloader logger were retained. Silence or a truncated ring does not "
            "prove that the bootloader did not execute."
        ),
    }
