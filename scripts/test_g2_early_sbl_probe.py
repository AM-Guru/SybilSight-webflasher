"""Early HELLO evidence must distinguish local reflection from SBL STATUS."""
import copy
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from case_early_sbl_probe.artifacts import inspect_build
from case_early_sbl_probe.protocol import ready_bytes,parse_ready,decode_result,fnv
from case_early_sbl_probe.validate import run
from test_g2_sbl_reset_capture import RetainedTarget

ROOT=Path(__file__).resolve().parents[1]
BUILDS=ROOT/'work/usb-stock-recovery-20261104/goal/early-sbl-builds'

class EarlySblTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.manifest,cls.payload=inspect_build(BUILDS/'left-1000000')

    def test_artifact_checks_import_without_hardware_transport(self):
        code="import sys;sys.modules['serial']=None;sys.modules['g2_case_rom']=None;from case_early_sbl_probe.artifacts import inspect_build"
        r=subprocess.run([sys.executable,'-c',code],cwd=ROOT/'scripts',capture_output=True,text=True)
        self.assertEqual(r.returncode,0,r.stderr)

    def test_readiness_binds_route_baud_and_operation(self):
        raw=ready_bytes(self.manifest)
        self.assertTrue(parse_ready(raw,self.manifest)['valid'])
        for change in [{'route':'right'},{'nominalBaud':115200}]:
            with self.assertRaises(ValueError):parse_ready(raw,{**self.manifest,**change})
        from case_uart_version_control.protocol import parse_ready as parse_version
        with self.assertRaises(ValueError):parse_version(raw,{**self.manifest,'receiveMode':'early-armed'})

    def test_manifest_rejects_added_reset_or_writer_and_incomplete_coverage(self):
        for change in [{'templeResetImplemented':True},{'firmwareWriteImplemented':True},
                       {'templeCommandAllowlist':['24000000a6']},{'cases':self.manifest['cases'][:-1]}]:
            with tempfile.TemporaryDirectory() as name:
                d=Path(name);m={**copy.deepcopy(self.manifest),**change}
                (d/'validated-manifest.json').write_text(json.dumps(m));(d/'bridge.bin').write_bytes(self.payload)
                with self.assertRaises(ValueError):inspect_build(d)

    def test_all_compiled_routes_and_bauds_accept_only_a_real_status_frame(self):
        for route in ['left','right']:
            for baud in [1000000,115200]:
                m,p=inspect_build(BUILDS/f'{route}-{baud}')
                r=run(p,route,baud,m['profile'],20,'valid')
                self.assertTrue(r['sblStatusVerified'])
                self.assertEqual(r['templeBytesSent'],8)
                self.assertEqual(r['resetActions'],0)

    def test_echo_corrupt_truncated_or_wrong_type_is_not_status(self):
        for case in ['echo-only','bad-checksum','truncated','other-command']:
            r=run(self.payload,'left',1000000,self.manifest['profile'],20,case)
            self.assertFalse(r['sblStatusVerified'])
            self.assertEqual(r['templeBytesSent'],160)

    def test_receive_configuration_and_acknowledgement_fail_closed(self):
        for case,status in [('rx-not-ready',17),('overrun-config',16),('uart-overrun',9)]:
            r=run(self.payload,'left',1000000,self.manifest['profile'],20,case)
            self.assertEqual(r['status'],status)
            self.assertFalse(r['sblStatusVerified'])
            if case!='uart-overrun':self.assertEqual(r['templeBytesSent'],0)

    def test_recomputed_checksum_does_not_allow_forged_transport_or_counts(self):
        m=self.manifest
        r=run(self.payload,'left',1000000,m['profile'],20,'silence',target=RetainedTarget())
        original=bytes.fromhex(r['retainedResultHex'])
        self.assertEqual(decode_result(original,m)['helloRequests'],20)
        for offset in [68,70,71,36,40,44]:
            data=bytearray(original);data[offset]^=1
            struct.pack_into('<I',data,252,fnv(data[:252]))
            with self.subTest(offset=offset),self.assertRaises(ValueError):decode_result(data,m)

if __name__=='__main__':unittest.main()
