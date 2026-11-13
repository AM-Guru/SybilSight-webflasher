#!/usr/bin/env python3
"""Audit the reconstructed Even bootloader log route against OpenCFW sources."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(source: str, snippet: str, label: str) -> None:
    if source.count(snippet) != 1:
        raise ValueError(f"OpenCFW source anchor differs: {label}")


def build_audit(opencfw_root: Path) -> dict:
    base = opencfw_root / "g2/src"
    paths = {
        "bootPlatform": base / "apollo-bootloader/platform-startup/platform_startup.c",
        "bootLogWrapper": base / "apollo-bootloader/initializer-callbacks/native_uart_log_abi_wrapper.c",
        "bootMain": base / "apollo-bootloader/main-init/main_init.c",
        "bootManager": base / "apollo-bootloader/manager-task/manager_task.c",
        "bootInitializedData": base / "apollo-bootloader/startup/initialized_data.c",
        "mainBoardData": base / "apollo-main/hal/S1-drivers-hal-ble-data/board_data.c",
        "mainBoxManager": base / "apollo-main/drivers/power/box-detect/box_uart_mgr.c",
    }
    sources = {name: path.read_text() for name, path in paths.items()}
    require(sources["bootPlatform"], "42u, 44u, 4u, 4u,", "bootloader row-1 pins")
    require(sources["bootLogWrapper"], "opencfw_boot_uart_log_send(1u, borrowed, length)", "bootloader logger row")
    require(sources["bootMain"], '">>> Even Bootloader start <<<"', "bootloader banner")
    require(sources["bootManager"], '"otaFlag = 0x%x"', "OTA flag log")
    require(sources["bootManager"], '"need updata firmware"', "update decision log")
    require(sources["bootManager"], '"DO NOT need updata firmware, GO TO APP"', "application decision log")
    require(sources["bootInitializedData"], "0x000f4240u,0x00000203u,0x02020000u,0x00000000u,", "row-1 1-Mbaud configuration")
    require(sources["mainBoardData"], "g2_uart2_pins = {42u, 44u, 4u, 4u}", "application pogo pins")
    require(sources["mainBoardData"], "g2_uart2_config[4] = {1000000u", "application pogo baud")
    require(sources["mainBoxManager"], "#define BOX_UART            2u", "application case channel")
    return {
        "schemaVersion": 1,
        "operation": "opencfw-even-bootloader-pogo-log-route-audit",
        "sourceFiles": {
            name: {"path": str(path.resolve()), "sha256": digest(path)}
            for name, path in paths.items()
        },
        "bootloaderLoggerRow": 1,
        "apolloRxPin": 42,
        "apolloTxPin": 44,
        "pinFunction": 4,
        "nominalBaud": 1_000_000,
        "sameAsApplicationCaseUart2": True,
        "exactMarkers": [
            ">>> Even Bootloader start <<<",
            "otaFlag = 0x",
            "need updata firmware",
            "DO NOT need updata firmware, GO TO APP",
        ],
        "physicalDevicesOpened": False,
        "firmwareBytesSent": 0,
        "physicalRouteVerified": False,
        "conclusion": (
            "The reconstructed stock Even bootloader logger is configured for the same "
            "Apollo pins and nominal baud as the application pogo UART. A retained exact "
            "marker is a stage discriminator; a silent or truncated capture is not proof "
            "that the bootloader did not execute."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opencfw-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")
    report = build_audit(args.opencfw_root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "sourceFiles"}, indent=2))


if __name__ == "__main__":
    main()
