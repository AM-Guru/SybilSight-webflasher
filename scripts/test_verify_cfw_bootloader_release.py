#!/usr/bin/env python3
"""Offline release-gate tests using the pinned local WebFlasher CFW."""

import copy
import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify_cfw_bootloader_release as gate

ROOT = Path(os.environ.get("SYBILSIGHT_WEBFLASHER_TEST_ROOT", Path(__file__).resolve().parents[1])) / "public"
CATALOG = ROOT / "firmware-updates/source-files/index.json"


class BootloaderReleaseGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        catalog = json.loads(CATALOG.read_text())
        cls.current = next(r for r in catalog["releases"] if r["channel"] == "custom")

    def test_pinned_existing_release_remains_valid(self):
        gate.validate_release(self.current, ROOT)

    def test_future_release_without_patch_is_rejected(self):
        candidate = copy.deepcopy(self.current)
        candidate["id"] = "future-custom"
        with self.assertRaisesRegex(ValueError, "bootloaderPatch provenance"):
            gate.validate_release(candidate, ROOT)

    def test_unreviewed_stock_base_is_rejected(self):
        candidate = copy.deepcopy(self.current)
        candidate["id"] = "future-custom"
        candidate["bootloaderPatch"] = {
            "source": gate.PATCH_SOURCE,
            "sourceCommit": "6198d70e18293caebf8314d2e40bd3b1d0a5ee16",
            "stockSha256": "52ed1c4d043f278f9011d2f2e6555b668ef2ff1e312695f5c28fa7986523b75b",
            "patchedSha256": "not-an-approved-output",
        }
        with self.assertRaisesRegex(ValueError, "no approved patch"):
            gate.validate_release(candidate, ROOT)

    def test_stock_bootloader_cannot_be_relabelled_as_patched(self):
        candidate = copy.deepcopy(self.current)
        candidate["id"] = "future-custom"
        stock_sha = "52ed1c4d043f278f9011d2f2e6555b668ef2ff1e312695f5c28fa7986523b75b"
        commit = "6198d70e18293caebf8314d2e40bd3b1d0a5ee16"
        candidate["bootloaderPatch"] = {
            "source": gate.PATCH_SOURCE,
            "sourceCommit": commit,
            "stockSha256": stock_sha,
            "patchedSha256": stock_sha,
        }
        gate.APPROVED_BOOTLOADER_PATCHES[stock_sha] = (stock_sha, commit)
        try:
            with self.assertRaisesRegex(ValueError, "patch provenance"):
                gate.validate_release(candidate, ROOT)
        finally:
            gate.APPROVED_BOOTLOADER_PATCHES.clear()

    def test_legacy_release_cannot_change_bytes(self):
        candidate = copy.deepcopy(self.current)
        candidate["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "catalog pin"):
            gate.validate_release(candidate, ROOT)


if __name__ == "__main__":
    unittest.main()
