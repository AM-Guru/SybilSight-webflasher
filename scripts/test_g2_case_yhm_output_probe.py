from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from g2_case_yhm_output_probe import parse_yhm


class CaseYhmOutputProbeTests(unittest.TestCase):
    def test_real_hardware_capture_has_separate_live_and_shadow(self):
        root = Path(__file__).resolve().parents[1]
        raw = (root / "work/usb-stock-recovery-20261104/goal/"
               "original-case-yhm-output-20261111-v2-off.bin").read_bytes()
        sample = parse_yhm(raw)
        self.assertEqual(sample["hardwareReg3"], 0xAE)
        self.assertEqual(sample["hardwareReg4"], 0xAE)
        self.assertEqual(sample["shadowReg3"], 0xAE)
        self.assertEqual(sample["shadowReg4"], 0xAE)

    def test_incomplete_bus_read_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_yhm(b"0x00-0x07:81 0 4 ae\r\n2510: 0x00-0x07:81 00 04 ae ae 03 81 20\r\n")


if __name__ == "__main__":
    unittest.main()
