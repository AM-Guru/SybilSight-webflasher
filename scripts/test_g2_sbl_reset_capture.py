"""Reset probe transport/retained-proof validation, without opening hardware."""
import copy
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from case_sbl_reset_capture.artifacts import inspect_build
from case_sbl_reset_capture.protocol import ready_bytes, parse_ready, decode_result
from case_sbl_reset_capture.trace import extract, fnv
from case_sbl_reset_capture.validate import run

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT/"work/usb-stock-recovery-20261104/reset-capture-builds/right-1000000"
REFERENCE = Path("/Users/kalani/Repo/evenRealities-openCFW/g2/blobs/official/g2-2.2.6.10/firmware_box.bin")


class ResetCaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest,cls.payload = inspect_build(BUILD)

    def test_offline_artifact_imports_do_not_load_device_transport(self):
        code = "import sys; sys.modules['serial']=None; sys.modules['g2_case_rom']=None; sys.modules['g2_case_pogo_flasher']=None; from case_sbl_reset_capture.artifacts import inspect_build"
        result = subprocess.run([sys.executable,"-c",code],cwd=ROOT/"scripts",capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_modified_native_code_cannot_supply_a_reset_trace(self):
        code = bytearray(REFERENCE.read_bytes())
        code[32+0xb678] ^= 1
        with self.assertRaisesRegex(ValueError,"reviewed complete case code"):
            extract(code)

    def test_readiness_binds_reset_action_identity_route_and_baud(self):
        data = ready_bytes(self.manifest)
        self.assertEqual(len(data),32)
        self.assertTrue(parse_ready(data,self.manifest)["valid"])
        for change in ({"route":"left"},{"nominalBaud":115200}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                parse_ready(data,{**self.manifest,**change})
        other = copy.deepcopy(self.manifest)
        other["resetTrace"]["actionFnv"] ^= 1
        with self.assertRaises(ValueError):
            parse_ready(data,other)

    def test_readiness_rejects_truncation_corruption_and_hello_echo(self):
        data = ready_bytes(self.manifest)
        for bad in (data[:-1],data[:-1]+bytes([data[-1]^1]),bytes.fromhex("14559de900000800")):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                parse_ready(bad,self.manifest)

    def test_host_readiness_resynchronizes_after_serial_noise(self):
        from case_sbl_reset_capture.run import read_ready
        capture = bytearray(b"startup noise\0"+ready_bytes(self.manifest))
        port = SimpleNamespace(timeout=None,read=lambda count: bytes([capture.pop(0)]) if capture else b"")
        self.assertTrue(read_ready(port,self.manifest)["valid"])

    def test_lost_launch_ack_does_not_trigger_a_second_launch(self):
        from case_sbl_reset_capture.run import launch_and_wait
        audit = {}
        port = SimpleNamespace(dtr=False)
        with patch("case_sbl_reset_capture.run.go_sram",side_effect=TimeoutError("lost ACK")) as launch, \
             patch("case_sbl_reset_capture.run.read_ready",return_value={"valid":True}), \
             patch("case_sbl_reset_capture.run.time.monotonic",side_effect=[10,30]), \
             patch("builtins.print"):
            launch_and_wait(port,self.manifest,audit)
        launch.assert_called_once_with(port)
        self.assertTrue(port.dtr)
        self.assertTrue(audit["launchAttempted"])
        self.assertFalse(audit["launchAcknowledged"])
        self.assertIn("readyAcknowledgement",audit)

    def test_payload_and_operation_tampering_fail_before_usb(self):
        for kind in ("payload","operation","coverage","trace"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                manifest = copy.deepcopy(self.manifest)
                payload = self.payload
                if kind == "payload": payload = payload[:-1]+bytes([payload[-1]^1])
                elif kind == "operation": manifest["operation"] = "fixed-hello-discovery-only"
                elif kind == "coverage": manifest["cases"] = manifest["cases"][:-1]
                else: manifest["resetTrace"]["actions"][4][1] ^= 1
                (directory/"bridge.bin").write_bytes(payload)
                (directory/"validated-manifest.json").write_text(json.dumps(manifest))
                with self.assertRaises(ValueError): inspect_build(directory)

    def test_rechecksummed_success_cannot_omit_the_train_or_restore(self):
        result = run(self.payload,"right",1_000_000,self.manifest["profile"],20,"silence",
                     trace=self.manifest["resetTrace"],target=RetainedTarget())
        original = bytes.fromhex(result["retainedResultHex"])
        self.assertTrue(decode_result(original,self.manifest)["trainCompleted"])
        for offset,value in ((212,102),(208,0),(248,0),(69,15)):
            data = bytearray(original)
            if offset == 69: data[offset]=value
            else: struct.pack_into("<I",data,offset,value)
            struct.pack_into("<I",data,252,fnv(data[:252]))
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                decode_result(data,self.manifest)


class RetainedTarget:
    """Silent fixed target with a simple monotonic millisecond clock."""
    def __init__(self):
        self.now_us=0; self.case_rx=[]; self.uart_error=0
    def bind(self,manifest): pass
    def ready(self): pass
    def set_gpio(self,*args): pass
    def set_receive(self,*args): pass
    def stock_reset_action(self,*args): pass
    def busy_delay(self,count): self.now_us += (count*6+63)//64
    def tx_setup(self): pass
    def turnaround(self): pass
    def advance_to(self,time): self.now_us=time
    def next_event(self,fallback): return fallback
    def write_case_byte(self,value): self.now_us+=10
    def report(self): return {"syntheticSilentTarget":True}


if __name__ == "__main__":
    unittest.main()
