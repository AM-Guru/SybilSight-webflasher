import json
from pathlib import Path
import shutil
import tempfile
import unittest

from case_sbl_stock_writer.artifacts import inspect


ROOT = Path(__file__).resolve().parents[1]
BUILDS = {
    115_200: ROOT / "work/usb-stock-recovery-20261104/goal/sbl-stock-writer-2.4.0.24-115200-build-v1",
    1_000_000: ROOT / "work/usb-stock-recovery-20261104/goal/sbl-stock-writer-2.4.0.24-1000000-build-v1",
}
STOCK = ROOT / "work/usb-stock-recovery-20261104/goal/stock-2.4.0.24/ota_s200_firmware_ota.bin"
ARCHIVED = {
    "2.2.6.10": (
        Path("/Users/kalani/Repo/evenRealities-openCFW/g2/blobs/official/g2-2.2.6.10/ota_s200_firmware_ota.bin"),
        {baud: ROOT / f"work/usb-stock-recovery-20261104/goal/sbl-stock-writer-2.2.6.10-{baud}-build-v2"
         for baud in (115_200, 1_000_000)},
    ),
    "2.3.2.14": (
        Path("/Users/kalani/Repo/evenRealities-openCFW/g2/blobs/official/g2-2.3.2.14/ota_s200_firmware_ota.bin"),
        {115_200: ROOT / "work/usb-stock-recovery-20261104/goal/sbl-stock-writer-2.3.2.14-115200-build-v3",
         1_000_000: ROOT / "work/usb-stock-recovery-20261104/goal/sbl-stock-writer-2.3.2.14-1000000-build-v2"},
    ),
}


class Schema13ArtifactTests(unittest.TestCase):
    def test_prior_stock_release_remains_hash_bound(self):
        for version, (stock, builds) in ARCHIVED.items():
            for baud, build in builds.items():
                with self.subTest(version=version, baud=baud):
                    manifest, _ = inspect(build, stock, expected_baud=baud)
                    self.assertEqual(manifest["stockFirmwareVersion"], version)

    def test_exact_build_is_inspectable_without_hardware(self):
        for baud, build in BUILDS.items():
            with self.subTest(baud=baud):
                manifest, bridge = inspect(build, STOCK, expected_baud=baud)
                self.assertEqual(manifest["schemaVersion"], 13)
                self.assertEqual(manifest["nominalBaud"], baud)
                self.assertEqual(manifest["stockFirmwareVersion"], "2.4.0.24")
                self.assertEqual(len(bridge), 2952)
                self.assertFalse(manifest["hardwareExecuted"])

    def test_build_cannot_be_rebound_to_the_other_baud(self):
        with self.assertRaisesRegex(ValueError, "artifact identity"):
            inspect(BUILDS[115_200], STOCK, expected_baud=1_000_000)

    def test_bridge_or_manifest_tampering_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            copy = Path(temporary)
            for name in (
                "bridge.bin", "validator.bin", "baud_patch.bin",
                "validated-manifest.json",
            ):
                shutil.copy2(BUILDS[115_200] / name, copy / name)
            bridge = bytearray((copy / "bridge.bin").read_bytes())
            bridge[0] ^= 1
            (copy / "bridge.bin").write_bytes(bridge)
            with self.assertRaisesRegex(ValueError, "artifact identity"):
                inspect(copy, STOCK, expected_baud=115_200)

            shutil.copy2(BUILDS[115_200] / "bridge.bin", copy / "bridge.bin")
            manifest = json.loads((copy / "validated-manifest.json").read_text())
            manifest["hardwareExecuted"] = True
            (copy / "validated-manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "proof boundary"):
                inspect(copy, STOCK, expected_baud=115_200)


if __name__ == "__main__":
    unittest.main()
