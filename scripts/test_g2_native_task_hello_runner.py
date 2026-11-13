"""Host fixtures for schema-11 staging and the one-reset HELLO path."""
from contextlib import contextmanager
import struct
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from case_native_task_hello.protocol import configuration
from case_native_task_hello_flash.run_probe import CaseBackend
from case_native_task_hello_flash.stager import BASE, SIZE, HelloStager
from case_sbl_reset_prepared.trace import fnv


class HelloRunnerTests(unittest.TestCase):
    def fake_memory(self):
        data = bytearray(SIZE)

        @contextmanager
        def connect(*args):
            yield object()

        def read(port, address, size, attempts):
            return bytes(data[address - BASE : address - BASE + size])

        def write(port, address, block):
            data[address - BASE : address - BASE + len(block)] = block

        return data, connect, read, write

    def test_schema11_stager_clears_full_512_byte_result(self):
        data, connect, read, write = self.fake_memory()
        data[0x1A00:0x1C00] = b"E" * 512
        stager = HelloStager("unused")
        cfg = configuration("right", 1000000, 7)
        with patch("case_native_task_flash.stager.bound_rom", connect), patch(
            "case_native_task_flash.stager.read_memory", read
        ), patch("case_native_task_flash.stager.write_sram", write):
            stager.stage_hello(b"H" * 2240, cfg)
        self.assertEqual(data[:2240], b"H" * 2240)
        self.assertEqual(data[0x1A00:0x1C00], bytes(512))
        self.assertEqual(data[0x1F00:0x1F20], cfg)

    def test_bad_schema11_request_rejected_before_io(self):
        stager = HelloStager("unused")
        with patch("case_native_task_flash.stager.bound_rom") as connect:
            with self.assertRaises(ValueError):
                stager.stage_hello(b"H" * 2240, bytes(32))
            connect.assert_not_called()

    @staticmethod
    def silence_evidence(nonce):
        words = [0] * 64
        words[:8] = [0x31484E47, 11, 0, 5, 0x08009AFF, 0, 64, nonce]
        words[8:14] = [0, 0, 2, 2, 1, 1]
        words[14:17] = [1000, 1070, 1071]
        words[17:25] = [9200, 20, 160, 0, 0, 0, 0, 7]
        words[25:30] = [3, 0, 0, 19, 0]
        words[30:34] = [7, 63999, 7, 63999]
        words[34:39] = [0, 0, 0, 64, 0]
        words[39:44] = [0, 0, 0, 64, 0]
        words[56:64] = [0x00101008, 0, 0x12, 0x32020802, 0x00101008, 0, 1, 1]
        raw = bytearray(512)
        raw[:256] = struct.pack("<64I", *words)
        struct.pack_into("<I", raw, 508, fnv(raw[:508]))
        return bytes(raw)

    def test_route_uses_one_reset_and_preserves_silence_as_qualified_probe(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        reference = root / "reference.bin"
        reference.write_bytes(bytes(32) + b"stock")
        args = SimpleNamespace(
            output=root,
            device="unused",
            case_reference=reference,
            route="left",
        )
        report = {
            "pageOperations": [],
            "customTempleQueryBytes": 0,
            "validSblStatusFrames": 0,
        }
        hello = {"patched-case": b"patched", "hook": b"H" * 2240}
        backend = CaseBackend(
            args,
            report,
            b"writer",
            [[b"A" * 2048, b"B" * 2048], [b"C" * 2048, b"D" * 2048]],
            hello,
            bytes(SIZE),
            {},
            {},
        )
        captured = {}

        def stage(payload, cfg):
            captured["cfg"] = cfg

        backend.loader.stage_hello = stage
        backend.loader.bytes_written = 0
        cfg = configuration("left", 1000000, 123)

        def read(address, size):
            if address == 0x08000000:
                return hello["patched-case"]
            if address == BASE:
                return hello["hook"]
            if address == 0x20011F00:
                return cfg if size == 32 else bytes(8)
            if address == 0x20011A00:
                return self.silence_evidence(123)
            raise AssertionError((hex(address), size))

        backend.read = read
        backend.verify = lambda address, expected, label: self.assertEqual(
            read(address, len(expected)), expected
        )
        reset = {
            "reset_confirmed": True,
            "case_version": "1.2.57",
            "left_present": True,
            "right_present": True,
        }
        with patch(
            "case_native_task_hello_flash.run_probe.secrets.randbits", return_value=123
        ), patch(
            "case_native_task_hello_flash.run_probe.checked_console", return_value=reset
        ) as command, patch("case_native_task_hello_flash.run_probe.time.sleep"):
            result = backend.observe_context()
        self.assertEqual(command.call_count, 1)
        self.assertEqual(captured["cfg"], cfg)
        self.assertTrue(result["probeQualified"])
        self.assertFalse(result["discovery"]["statusFrames"])
        self.assertEqual(report["customTempleQueryBytes"], 160)
        self.assertEqual(report["validSblStatusFrames"], 0)


if __name__ == "__main__":
    unittest.main()
