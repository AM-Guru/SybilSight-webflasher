import json
from pathlib import Path
import shutil
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from case_pogo_edge_capture.artifacts import inspect
from case_pogo_edge_capture.protocol import RAW_CAPACITY, configuration
from case_pogo_edge_capture.run_capture import PogoEdgeCaptureBackend, validate_staging
from case_pogo_edge_capture.stager import CONFIG, EVIDENCE, PassiveBootlogStager, BASE, SIZE
from case_pogo_edge_capture.validate import evidence
from case_pogo_edge_capture.writer_artifacts import inspect_writer
from g2_even_bootlog import BOOT_BANNER, UPDATE_DECISION


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "work/usb-stock-recovery-20261104/goal/case-pogo-edge-capture-build-v1"
CASE = Path("/Users/kalani/Repo/evenRealities-openCFW/g2/blobs/official/g2-2.2.6.10/firmware_box.bin")
EMULATOR = Path("/Users/kalani/Repo/g2-firmware-emulator/work/case-pogo-edge-capture-v1/report.json")
GOAL = ROOT / "work/usb-stock-recovery-20261104/goal"
PLAN = GOAL / "case-pogo-edge-capture-plan-v1"
WRITER = GOAL / "case-pogo-edge-capture-writer-v1"


class PogoEdgeCaptureRunnerTests(unittest.TestCase):
    @staticmethod
    def fake_memory():
        data = bytearray(SIZE)

        class Port:
            pass

        from contextlib import contextmanager

        @contextmanager
        def connect(*_args, **_kwargs):
            yield Port()

        def read(_port, address, size, attempts):
            del attempts
            return bytes(data[address - BASE:address - BASE + size])

        def write(_port, address, block):
            data[address - BASE:address - BASE + len(block)] = block

        return data, connect, read, write

    def test_exact_artifact_is_passive_and_offline_qualified(self):
        manifest, artifacts = inspect(BUILD, CASE)
        self.assertEqual(manifest["schemaVersion"], 15)
        self.assertEqual(manifest["maxTempleBytesSent"], 0)
        self.assertEqual(manifest["templeCommandAllowlist"], [])
        self.assertEqual(manifest["retainedTempleBytes"], RAW_CAPACITY)
        self.assertTrue(manifest["captureStartsBeforeInsertion"])
        self.assertEqual(manifest["insertionWaitTicks"], 12_000)
        self.assertEqual(manifest["passiveCaptureTicks"], 15_000)
        self.assertEqual(manifest["postPulseCaptureTicks"], 3_000)
        self.assertEqual(manifest["captureClock"], "systick-wrap-counter")
        self.assertEqual(manifest["postPulseCaptureTicks"], 3_000)
        self.assertEqual(manifest["retentionPolicy"], "first-bytes-saturating")
        self.assertEqual(manifest["acceptedInitialUartBrr"], [0, 64])
        self.assertFalse(manifest["hardwareValidated"])
        self.assertGreater(len(artifacts["hook"]), 0)

    def test_compiled_runtime_fixtures_never_write_uart_tx(self):
        manifest = json.loads((BUILD / "validated-manifest.json").read_text())
        self.assertEqual(len(manifest["runtimeCases"]), 8)
        self.assertEqual(
            {row["initialUartBrr"] for row in manifest["runtimeCases"]}, {0, 64}
        )
        self.assertTrue(all(row["uartTxWrites"] == 0 for row in manifest["runtimeCases"]))
        self.assertTrue(all(row["evidence"]["templeBytesSent"] == 0 for row in manifest["runtimeCases"]))
        self.assertTrue(all(row["halTickAdvanced"] is False for row in manifest["runtimeCases"]))

    def test_emulator_cross_check_and_configuration_identity(self):
        report = json.loads(EMULATOR.read_text())
        self.assertTrue(report["passed"])
        self.assertTrue(report["compiledHookExecuted"])
        self.assertEqual(report["templeCommandBytesSent"], 0)
        self.assertEqual(len(configuration("left", 1)), 32)
        self.assertNotEqual(configuration("left", 1), configuration("right", 1))

    def test_exact_page_plan_and_writer_are_offline_only(self):
        report, payload, pages = inspect_writer(WRITER, PLAN, BUILD, CASE)
        self.assertEqual(report["schemaVersion"], 15)
        self.assertEqual(len(report["cases"]), 27)
        self.assertFalse(report["hardwareQualified"])
        self.assertFalse(report["hostMutationRunnerImplemented"])
        self.assertEqual(report["maxTempleBytesSent"], 0)
        self.assertGreater(len(payload), 0)
        self.assertEqual(len(pages), 2)

    def test_writer_report_hardware_claim_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / "writer"
            shutil.copytree(WRITER, copied)
            path = copied / "validated-writer.json"
            report = json.loads(path.read_text())
            report["hardwareQualified"] = True
            path.write_text(json.dumps(report))
            with self.assertRaises(ValueError):
                inspect_writer(copied, PLAN, BUILD, CASE)

    def test_tampered_exact_plan_page_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / "plan"
            shutil.copytree(PLAN, copied)
            path = copied / "patched-08009800.bin"
            data = bytearray(path.read_bytes())
            data[0] ^= 1
            path.write_bytes(data)
            with self.assertRaises(ValueError):
                inspect_writer(WRITER, copied, BUILD, CASE)

    def test_schema15_stager_clears_full_evidence_and_rejects_bad_schema(self):
        data, connect, read, write = self.fake_memory()
        evidence_offset = EVIDENCE - BASE
        data[evidence_offset:evidence_offset + 1280] = b"E" * 1280
        stager = PassiveBootlogStager("unused")
        cfg = configuration("left", 7)
        with patch("case_native_task_flash.stager.bound_rom", connect), patch(
            "case_native_task_flash.stager.read_memory", read
        ), patch("case_native_task_flash.stager.write_sram", write):
            stager.stage_probe(b"H" * 1704, cfg)
        self.assertEqual(data[:1704], b"H" * 1704)
        self.assertEqual(data[evidence_offset:evidence_offset + 1280], bytes(1280))
        self.assertEqual(data[CONFIG - BASE:CONFIG - BASE + 32], cfg)
        with patch("case_native_task_flash.stager.bound_rom") as open_rom:
            with self.assertRaises(ValueError):
                stager.stage_probe(b"H" * 1704, bytes(32))
            open_rom.assert_not_called()

    def test_passive_backend_retains_marker_without_transmitting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.bin"
            reference.write_bytes(bytes(32) + b"stock")
            args = SimpleNamespace(
                output=root, device="unused", case_reference=reference,
                route="left",
            )
            report = {
                "pageOperations": [], "templeCommandBytes": 0,
                "sramDirty": False,
            }
            probe = {"patched-case": b"patched", "hook": b"H" * 1704}
            backend = PogoEdgeCaptureBackend(
                args, report, b"writer",
                [[b"A" * 2048, b"B" * 2048], [b"C" * 2048, b"D" * 2048]],
                probe, bytes(SIZE), {}, {},
            )
            captured = {}
            backend.loader.stage_probe = lambda payload, cfg: captured.update(payload=payload, cfg=cfg)
            backend.loader.bytes_written = 0
            cfg = configuration("left", 123)
            raw = evidence(
                BOOT_BANNER + b"\r\n" + UPDATE_DECISION,
                nonce=123,
                post_edges=(6000, 317, 3000, 7),
            )

            def read(address, size):
                if address == 0x08000000:
                    return probe["patched-case"]
                if address == BASE:
                    return probe["hook"]
                if address == CONFIG:
                    return cfg if size == 32 else bytes(8)
                if address == EVIDENCE:
                    return raw
                raise AssertionError((hex(address), size))

            backend.read = read
            backend.verify = lambda address, expected, _label: self.assertEqual(
                read(address, len(expected)), expected
            )
            with patch(
                "case_pogo_edge_capture.run_capture.secrets.randbits", return_value=123
            ), patch(
                "case_pogo_edge_capture.run_capture.locked_reset_without_queries",
                return_value={"resetSent": True, "resetConfirmed": True, "templeQueryBytes": 0},
            ) as reset, patch("case_pogo_edge_capture.run_capture.time.sleep"):
                result = backend._observe_route("left")
            reset.assert_called_once()
            self.assertEqual(captured["payload"], probe["hook"])
            self.assertEqual(captured["cfg"], cfg)
            self.assertEqual(result["templeBytesSent"], 0)
            self.assertTrue(result["evenBootloaderLog"]["bootBannerObserved"])
            self.assertEqual(report["templeCommandBytes"], 0)
            self.assertTrue(report["evenBootloaderLogObserved"])
            self.assertTrue(report["rawPb9ElectricalActivityObserved"])

    def test_runner_rejects_provenance_free_staging_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audit.json"
            writer = (WRITER / "writer.bin").read_bytes()
            path.write_text(json.dumps({
                "operation": "schema15-passive-pb9-changed-range-staging-qualification",
                "schemaVersion": 15,
                "caseSerial": "002300405845501620373941",
                "writerPayloadSha256": __import__("hashlib").sha256(writer).hexdigest(),
                "outcome": "mode2-and-original-restore-verified",
                "originalSramRestoredAndVerified": True,
                "candidatePagesUnchanged": True,
                "stockVersionRestored": "1.2.57",
                "flashWrites": 0,
                "templeCommandBytes": 0,
                "glassesFirmwareImageBytes": 0,
                "rows": [
                    {"page": page, "result": {
                        "status": 0, "mode": 2, "page": page,
                        "eraseStarts": 0, "programDoublewords": 0, "busyAtEnd": False,
                    }} for page in (0, 1)
                ],
                "sourceHashes": {},
            }))
            with self.assertRaisesRegex(ValueError, "provenance"):
                validate_staging(path, writer)


if __name__ == "__main__":
    unittest.main()
