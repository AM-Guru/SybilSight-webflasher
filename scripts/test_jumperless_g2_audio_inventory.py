"""The board inventory must remain read-only and produce parseable routes."""
import contextlib
import io
import json
from pathlib import Path
import runpy
import sys
import types
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("jumperless_g2_audio_inventory.py")


class JumperlessAudioInventoryTests(unittest.TestCase):
    def test_emulated_inventory_reads_without_mutating_board(self):
        board = types.ModuleType("jumperless")
        board.get_num_bridges = lambda: 2
        board.get_bridge = lambda index: [(110, 2, 0), (111, 1, 0)][index]
        board.dac_get = lambda channel: [0.0, 0.0, 0.0, 0.0][channel]
        board.ADC0 = 110
        board.ADC1 = 111
        stdout = io.StringIO()
        with patch.dict(sys.modules, {"jumperless": board}), contextlib.redirect_stdout(stdout):
            runpy.run_path(str(SCRIPT))
        line = stdout.getvalue().strip()
        self.assertTrue(line.startswith("G2JL_AUDIO_INVENTORY="))
        report = json.loads(line.split("=", 1)[1])
        self.assertEqual(report["bridges"], [[110, 2, 0], [111, 1, 0]])
        self.assertEqual(report["dacAndRailSettings"], [0.0] * 4)
        self.assertFalse(report["usbAudioSetupAvailable"])


if __name__ == "__main__":
    unittest.main()
