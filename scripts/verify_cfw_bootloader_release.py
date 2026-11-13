#!/usr/bin/env python3
"""Fail closed on future G2 CFW releases without a reviewed bootloader patch.

The current immutable 230.87 release predates this requirement. Future entries
need a version-bound, independently reviewed patched component digest. Add an
approval only after building the patch from a hash-pinned stock bootloader and
validating the complete EVENOTA bundle; this file never performs a flash.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from g2_pogo_protocol import parse_evenota

LEGACY_CUSTOM_RELEASES = {
    "g2-custom-2.3.0.24-230.87":
        "97dcac92482bfe01b6375b6096f949572261a299a0341489299c1eb6ffae6fbb",
}

# stock bootloader SHA-256 -> (patched component SHA-256, source commit).
# The drdaeman/g2-bootloader-patch 6198d70 source only accepts stock 2.3.2.14
# (22a2b98e606b4d296e957a3a8b600a2158497638d79485c817c2025536329ba7).
# Current CFW uses stock 2.3.0.24 (52ed1c4d043f278f9011d2f2e6555b668ef2ff1e312695f5c28fa7986523b75b),
# so no output digest is approved yet. Never fill this map from release metadata.
APPROVED_BOOTLOADER_PATCHES: dict[str, tuple[str, str]] = {}
PATCH_SOURCE = "https://github.com/drdaeman/g2-bootloader-patch"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_release(entry: dict, site_root: Path) -> None:
    release_id = entry["id"]
    bundle_path = (site_root / entry["url"].lstrip("/")).resolve()
    if not bundle_path.is_relative_to(site_root.resolve()):
        raise ValueError(f"{release_id}: bundle path escapes the deployment root")
    bundle = bundle_path.read_bytes()
    if len(bundle) != entry["size"] or sha256(bundle) != entry["sha256"]:
        raise ValueError(f"{release_id}: bundle does not match its catalog pin")

    if release_id in LEGACY_CUSTOM_RELEASES:
        if entry["sha256"] != LEGACY_CUSTOM_RELEASES[release_id]:
            raise ValueError(f"{release_id}: immutable legacy CFW pin changed")
        return

    patch = entry.get("bootloaderPatch")
    if not isinstance(patch, dict):
        raise ValueError(f"{release_id}: future CFW needs bootloaderPatch provenance")
    stock_sha = patch.get("stockSha256")
    approved = APPROVED_BOOTLOADER_PATCHES.get(stock_sha)
    if approved is None:
        raise ValueError(f"{release_id}: no approved patch for stock bootloader {stock_sha}")
    patched_sha, source_commit = approved
    if (
        patch.get("source") != PATCH_SOURCE
        or patch.get("sourceCommit") != source_commit
        or patch.get("patchedSha256") != patched_sha
        or patched_sha == stock_sha
    ):
        raise ValueError(f"{release_id}: patch provenance differs from reviewed source")

    bootloaders = [
        component for component in parse_evenota(bundle_path)
        if component.filename == "ota/s200_bootloader.bin" and component.type_id == 1
    ]
    if len(bootloaders) != 1 or sha256(bootloaders[0].payload) != patched_sha:
        raise ValueError(f"{release_id}: bundle does not contain the approved bootloader")


def validate_catalog(catalog_path: Path, site_root: Path) -> None:
    catalog = json.loads(catalog_path.read_text())
    for entry in catalog["releases"]:
        if entry.get("channel") == "custom":
            validate_release(entry, site_root)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: verify_cfw_bootloader_release.py CATALOG SITE_ROOT")
    validate_catalog(Path(sys.argv[1]), Path(sys.argv[2]))
