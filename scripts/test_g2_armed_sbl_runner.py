"""Fail-closed host fixtures for the schema-12 armed insertion runner."""
from contextlib import contextmanager
import struct
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from case_armed_sbl_probe.protocol import configuration
from case_armed_sbl_probe_flash.run_probe import (
    ArmedBackend,
    HOST_WAIT_SECONDS,
    locked_reset_without_queries,
)
from case_armed_sbl_probe_flash.stager import ArmedSblStager, BASE, SIZE
from case_sbl_reset_prepared.trace import fnv


class FakeConsole:
    def __init__(self):
        self.writes = []
        self.reads = 0

    def reset_input_buffer(self):
        return None

    def write(self, data):
        self.writes.append(bytes(data))
        return len(data)

    def flush(self):
        return None

    def read(self, _size):
        self.reads += 1
        return b"reset gls L & R, reason: cmd" if self.reads == 1 else b""


class ArmedSblRunnerTests(unittest.TestCase):
    def test_host_wait_covers_hardware_derived_twenty_attempt_window(self):
        self.assertGreaterEqual(HOST_WAIT_SECONDS, 45.0)

    def fake_memory(self):
        data = bytearray(SIZE)

        @contextmanager
        def connect(*_args, **_kwargs):
            yield object()

        def read(_port, address, size, attempts):
            del attempts
            return bytes(data[address - BASE : address - BASE + size])

        def write(_port, address, block):
            data[address - BASE : address - BASE + len(block)] = block

        return data, connect, read, write

    def test_schema12_stager_clears_full_evidence_and_rejects_bad_schema_before_io(self):
        data, connect, read, write = self.fake_memory()
        data[0x1A00:0x1C00] = b"E" * 512
        stager = ArmedSblStager("unused")
        cfg = configuration("left", 1_000_000, 7)
        with patch("case_native_task_flash.stager.bound_rom", connect), patch(
            "case_native_task_flash.stager.read_memory", read
        ), patch("case_native_task_flash.stager.write_sram", write):
            stager.stage_probe(b"H" * 2360, cfg)
        self.assertEqual(data[:2360], b"H" * 2360)
        self.assertEqual(data[0x1A00:0x1C00], bytes(512))
        self.assertEqual(data[0x1F00:0x1F20], cfg)

        with patch("case_native_task_flash.stager.bound_rom") as open_rom:
            with self.assertRaises(ValueError):
                stager.stage_probe(b"H" * 2360, bytes(32))
            open_rom.assert_not_called()

    def test_locked_reset_writes_exactly_one_deb0_and_no_query(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        output = Path(temp.name) / "console"
        port = FakeConsole()

        @contextmanager
        def open_console(_device):
            yield port

        with patch(
            "case_armed_sbl_probe_flash.run_probe._open_case_console",
            open_console,
        ), patch(
            "case_armed_sbl_probe_flash.run_probe._drain_case_console",
            return_value=b"",
        ):
            result = locked_reset_without_queries("unused", output)

        self.assertEqual(port.writes, [b"DEB0\n"])
        self.assertEqual(result["templeQueryBytes"], 0)
        self.assertTrue(result["resetConfirmed"])
        self.assertEqual((output / "console.bin").read_bytes(), b"reset gls L & R, reason: cmd")

    @staticmethod
    def silence_evidence(nonce, brr=64):
        words = [0] * 64
        words[:8] = [0x31484E47, 12, 0, 5, 0x08009AFF, 0, brr, nonce]
        words[8:14] = [0, 0, 2, 2, 1, 1]
        words[14:17] = [1000, 16071, 16072]
        words[17:25] = [9200, 4, 32, 0, 0, 0, 0, 7]
        words[25:30] = [3, 0, 0, 3, 16000]
        words[30:34] = [7, 63999, 7, 63999]
        words[34:39] = [0, 0, 0, 64, 0]
        words[39:44] = [0, 0, 0, 64, 0]
        words[56:64] = [0x00101008, 0, 0x12, 0x32020802, 0x00101008, 0, 1, 1]
        raw = bytearray(512)
        raw[:256] = struct.pack("<64I", *words)
        struct.pack_into("<I", raw, 508, fnv(raw[:508]))
        return bytes(raw)

    def test_backend_preserves_qualified_silence_after_one_locked_reset(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        reference = root / "reference.bin"
        reference.write_bytes(bytes(32) + b"stock")
        args = SimpleNamespace(
            output=root, device="unused", case_reference=reference,
            route="left", baud=1_000_000,
        )
        report = {
            "pageOperations": [],
            "customTempleQueryBytes": 0,
            "validSblStatusFrames": 0,
            "sramDirty": False,
        }
        probe = {"patched-case": b"patched", "hook": b"H" * 2360}
        backend = ArmedBackend(
            args,
            report,
            b"writer",
            [[b"A" * 2048, b"B" * 2048], [b"C" * 2048, b"D" * 2048]],
            probe,
            bytes(SIZE),
            {},
            {},
        )
        captured = {}

        def stage(payload, cfg):
            captured["payload"] = payload
            captured["cfg"] = cfg

        backend.loader.stage_probe = stage
        backend.loader.bytes_written = 0
        cfg = configuration("left", 1_000_000, 123)

        def read(address, size):
            if address == 0x08000000:
                return probe["patched-case"]
            if address == BASE:
                return probe["hook"]
            if address == 0x20011F00:
                return cfg if size == 32 else bytes(8)
            if address == 0x20011A00:
                return self.silence_evidence(123)
            raise AssertionError((hex(address), size))

        backend.read = read
        backend.verify = lambda address, expected, _label: self.assertEqual(
            read(address, len(expected)), expected
        )
        reset = {
            "operation": "single-deb0-without-temple-query",
            "templeQueryBytes": 0,
            "resetSent": True,
            "resetConfirmed": True,
        }
        with patch(
            "case_armed_sbl_probe_flash.run_probe.secrets.randbits",
            return_value=123,
        ), patch(
            "case_armed_sbl_probe_flash.run_probe.locked_reset_without_queries",
            return_value=reset,
        ) as command, patch("case_armed_sbl_probe_flash.run_probe.time.sleep"):
            result = backend._observe_route("left")

        command.assert_called_once()
        self.assertEqual(captured["payload"], probe["hook"])
        self.assertEqual(captured["cfg"], cfg)
        self.assertTrue(result["probeQualified"])
        self.assertEqual(result["insertionWaitHalTicks"], 15000)
        self.assertFalse(result["discovery"]["statusFrames"])
        self.assertEqual(report["customTempleQueryBytes"], 32)
        self.assertEqual(report["validSblStatusFrames"], 0)

    def test_backend_uses_explicit_vendor_default_115200_configuration(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        reference = root / "reference.bin"
        reference.write_bytes(bytes(32) + b"stock")
        args = SimpleNamespace(
            output=root, device="unused", case_reference=reference,
            route="left", baud=115_200,
        )
        report = {
            "pageOperations": [], "customTempleQueryBytes": 0,
            "validSblStatusFrames": 0, "sramDirty": False,
        }
        probe = {"patched-case": b"patched", "hook": b"H" * 2360}
        backend = ArmedBackend(
            args, report, b"writer",
            [[b"A" * 2048, b"B" * 2048], [b"C" * 2048, b"D" * 2048]],
            probe, bytes(SIZE), {}, {},
        )
        captured = {}
        backend.loader.stage_probe = lambda payload, cfg: captured.update(cfg=cfg)
        backend.loader.bytes_written = 0
        cfg = configuration("left", 115_200, 123)

        def read(address, size):
            if address == 0x08000000:
                return probe["patched-case"]
            if address == BASE:
                return probe["hook"]
            if address == 0x20011F00:
                return cfg if size == 32 else bytes(8)
            if address == 0x20011A00:
                return self.silence_evidence(123, 556)
            raise AssertionError((hex(address), size))

        backend.read = read
        backend.verify = lambda address, expected, _label: self.assertEqual(
            read(address, len(expected)), expected
        )
        with patch(
            "case_armed_sbl_probe_flash.run_probe.secrets.randbits", return_value=123
        ), patch(
            "case_armed_sbl_probe_flash.run_probe.locked_reset_without_queries",
            return_value={"resetSent": True, "resetConfirmed": True, "templeQueryBytes": 0},
        ), patch("case_armed_sbl_probe_flash.run_probe.time.sleep"):
            result = backend._observe_route("left")
        self.assertEqual(captured["cfg"], cfg)
        self.assertEqual(result["brr"], 556)


if __name__ == "__main__":
    unittest.main()
