"""Guarded Case-to-pad and audio tap routing under an emulated crossbar."""
from datetime import datetime, timezone
import sys
import types
import unittest
from unittest.mock import patch

from scripts import jumperless_g2_audio_route as route
from scripts.test_jumperless_reset_audio_capture import qualifier


def inventory():
    return {
        "kind": "read-only-g2-jumperless-audio-inventory",
        "usbAudioIsEnabled": {"available": True, "value": True},
        "usbAudioStatus": {"available": True, "value": {
            "enabled": True, "streaming": False, "left": 0, "right": 1,
            "sample_rate": 16000, "full_scale": 8.0, "dc_block": False,
        }},
        "bridges": [[102, 108, -1]],
        "dacAndRailSettings": [0.0] * 4,
        "adc0": 110,
        "adc1": 111,
    }


class FakeBoard(types.ModuleType):
    ADC0 = 110
    ADC1 = 111

    def __init__(self, baseline):
        super().__init__("jumperless")
        self.bridges = [tuple(b) for b in baseline]
        self.mutations = 0

    def get_num_bridges(self):
        return len(self.bridges)

    def get_bridge(self, index):
        return self.bridges[index]

    def dac_get(self, channel):
        return 0.0

    def connect(self, a, b, duplicates=0):
        self.mutations += 1
        self.bridges.append((a, b, duplicates))

    def disconnect(self, a, b):
        self.mutations += 1
        self.bridges.remove((a, b, 0))


class JumperlessRouteTests(unittest.TestCase):
    @staticmethod
    def audio_status():
        return {"enabled": True, "streaming": False, "left": 0, "right": 1,
                "sample_rate": 16000, "full_scale": 8.0, "dc_block": False}

    def test_prepare_and_restore_exact_routes(self):
        q = qualifier()
        inv = inventory()
        baseline, rails = route.validate_inventory(inv, "left", q, age_seconds=2)
        board = FakeBoard(baseline)
        audio = {"enabled": True}
        namespace = {"usb_audio_is_enabled": lambda: audio["enabled"],
                     "usb_audio_status": self.audio_status}
        with patch.dict(sys.modules, {"jumperless": board}):
            exec(route.build_device_code("left", baseline, rails, 110, 111,
                                         restore=False, resistive_case_links=True), namespace)
            self.assertEqual(sorted(board.bridges), sorted([
                (102, 108, -1), (22, 2, 0), (23, 1, 0), (110, 2, 0), (111, 1, 0)
            ]))
            audio["enabled"] = False  # USB audio may disappear before cleanup.
            exec(route.build_device_code("left", baseline, rails, 110, 111,
                                         restore=True, resistive_case_links=True), namespace)
        self.assertEqual(board.bridges, [(102, 108, -1)])

    def test_changed_baseline_refuses_before_mutation(self):
        inv = inventory()
        baseline, rails = route.validate_inventory(inv, "left", qualifier(), age_seconds=2)
        board = FakeBoard(baseline + [[20, 3, 0]])
        namespace = {"usb_audio_is_enabled": lambda: True,
                     "usb_audio_status": self.audio_status}
        with patch.dict(sys.modules, {"jumperless": board}):
            with self.assertRaisesRegex(RuntimeError, "differ"):
                exec(route.build_device_code("left", baseline, rails, 110, 111,
                                             restore=False, resistive_case_links=True), namespace)
        self.assertEqual(board.mutations, 0)

    def test_default_route_only_taps_audio_without_case_connection(self):
        inv = inventory()
        baseline, rails = route.validate_inventory(inv, "left", qualifier(), age_seconds=2)
        board = FakeBoard(baseline)
        namespace = {"usb_audio_is_enabled": lambda: True,
                     "usb_audio_status": self.audio_status}
        with patch.dict(sys.modules, {"jumperless": board}):
            exec(route.build_device_code("left", baseline, rails, 110, 111, restore=False), namespace)
        self.assertEqual(sorted(board.bridges), sorted([
            (102, 108, -1), (110, 2, 0), (111, 1, 0)
        ]))

    def test_stale_or_occupied_target_snapshot_refuses_generation(self):
        inv = inventory()
        with self.assertRaisesRegex(ValueError, "two minutes"):
            route.validate_inventory(inv, "left", qualifier(), age_seconds=121)
        inv["bridges"].append([20, 3, 0])
        with self.assertRaisesRegex(ValueError, "software isolated"):
            route.validate_inventory(inv, "left", qualifier(), age_seconds=2)

    def test_wrong_audio_configuration_refuses_generation(self):
        inv = inventory()
        inv["usbAudioStatus"]["value"]["dc_block"] = True
        with self.assertRaisesRegex(ValueError, "settings differ"):
            route.validate_inventory(inv, "left", qualifier(), age_seconds=2)


if __name__ == "__main__":
    unittest.main()
