"""Offline regression checks for the stock-address gate; no compiler or device."""

import copy
import json
import unittest

from scripts import build_g2flash_cfw_2_2_10 as cfw


class AddressGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profile = json.loads(cfw.PROFILE.read_text())
        cls.previous = cfw.PREVIOUS.read_bytes()
        cls.stock = cfw.STOCK.read_bytes()

    def test_reviewed_mapping_matches_both_stock_images(self):
        self.assertEqual(cfw.validate_profile(self.profile, self.previous, self.stock), 139)

    def test_different_stock_is_rejected_before_address_checks(self):
        corrupt = bytearray(self.stock)
        corrupt[-1] ^= 1
        with self.assertRaisesRegex(cfw.BuildError, "stock SHA-256 mismatch"):
            cfw.validate_profile(self.profile, self.previous, corrupt)

    def test_reusing_the_previous_settings_call_address_is_rejected(self):
        profile = copy.deepcopy(self.profile)
        profile["addresses"]["0x47d809"]["new"] = "0x47d809"
        with self.assertRaisesRegex(cfw.BuildError, "Stock signature mismatch"):
            cfw.validate_profile(profile, self.previous, self.stock)

    def test_reusing_previous_sensor_ram_is_rejected(self):
        profile = copy.deepcopy(self.profile)
        profile["addresses"]["0x200763f0"]["new"] = "0x200763f0"
        with self.assertRaisesRegex(cfw.BuildError, "RAM literal mismatch"):
            cfw.validate_profile(profile, self.previous, self.stock)

    def test_idle_input_gate_callee_is_checked_without_bl_in_its_name(self):
        profile = copy.deepcopy(self.profile)
        hook = next(h for h in profile["hooks"] if h["symbol"] == "IDLE_INPUT_GATE_SITE")
        hook["newAddress"] = "0x45f386"  # the neighbouring head-up gate call
        hook["newStockBytes"] = "10f0c8f9"
        with self.assertRaisesRegex(cfw.BuildError, "Hook callee changed unexpectedly"):
            cfw.validate_profile(profile, self.previous, self.stock)

    def test_forced_fast_mode_site_checks_the_following_call(self):
        profile = copy.deepcopy(self.profile)
        profile["addresses"]["0x4745bd"]["new"] = "0x4b4ea5"
        with self.assertRaisesRegex(cfw.BuildError, "Stock signature mismatch|Hook callee changed"):
            cfw.validate_profile(profile, self.previous, self.stock)

    def test_ring_battery_cache_cannot_reuse_previous_ram(self):
        profile = copy.deepcopy(self.profile)
        profile["addresses"]["0x200772a6"]["new"] = "0x200772a6"
        with self.assertRaisesRegex(cfw.BuildError, "RAM literal mismatch"):
            cfw.validate_profile(profile, self.previous, self.stock)

    def test_ring_battery_abi_bytes_are_pinned(self):
        profile = copy.deepcopy(self.profile)
        profile["ringBatteryStockAbi"][0]["newBytes"] = "00" + profile["ringBatteryStockAbi"][0]["newBytes"][2:]
        with self.assertRaisesRegex(cfw.BuildError, "ring-battery ABI mismatch"):
            cfw.validate_profile(profile, self.previous, self.stock)

    def test_gesture_call_cannot_use_a_nearby_site(self):
        profile = copy.deepcopy(self.profile)
        hook = next(h for h in profile["hooks"] if h["symbol"] == "GESTURE_PRESS_SITE")
        hook["newAddress"] = "0x444ac0"  # the neighboring tap-then-long state getter
        hook["newStockBytes"] = "24f0a3fa"
        with self.assertRaisesRegex(cfw.BuildError, "Hook callee changed unexpectedly"):
            cfw.validate_profile(profile, self.previous, self.stock)


if __name__ == "__main__":
    unittest.main()
