"""Known stock component checks for the bounded startup-data parser."""

import unittest
from pathlib import Path

from audit_g2_bootloader_uart_rows import audit, decode_record


ROOT = Path(__file__).resolve().parents[1]
COMPONENTS = ROOT / "public/firmware-updates/source-files"


class BootloaderUartRowsTest(unittest.TestCase):
    def test_old_component_matches_independent_opencfw_data_digest(self):
        result = audit(COMPONENTS / "2.2.6.10/ota_s200_bootloader.bin")
        self.assertEqual(
            result["initialized_data_sha256"],
            "e3bea7ccd46bc324829152b5b5a9069aecce5db243876273084d29bd7d47b843",
        )
        self.assertEqual(result["uart_table_ram_address"], "0x20000454")
        self.assertEqual(result["rows"][2]["rom_config_words"], [42, 44, 4, 4])

    def test_latest_component_has_uart2_and_no_startup_callback(self):
        result = audit(COMPONENTS / "2.4.0.24/ota_s200_bootloader.bin")
        self.assertEqual(
            result["source_sha256"],
            "ecb91896234392e2b98ec80b1ac3ebf4aa27726d3cbed10927edf0b44d83d665",
        )
        self.assertEqual(result["uart_table_ram_address"], "0x20000458")
        uart2 = result["rows"][2]
        self.assertEqual(uart2["baud"], 1000000)
        self.assertEqual(uart2["rom_config_words"], [42, 44, 4, 4])
        self.assertEqual(uart2["receive_buffer"], "0x20080400")
        self.assertEqual(uart2["startup_callback"], "0x00000000")

    def test_rejects_out_of_image_record(self):
        with self.assertRaises(ValueError):
            decode_record(bytes(16), 0)


if __name__ == "__main__":
    unittest.main()
