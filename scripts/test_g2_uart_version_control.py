"""Fail-closed artifact and transaction checks for the new UART control."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import struct
import tempfile
import unittest
from case_uart_version_control.artifacts import inspect_build
from case_uart_version_control.protocol import ready_bytes,parse_ready,decode_result,fnv
from case_uart_version_control.validate import run

ROOT=Path(__file__).resolve().parents[1]
BUILD=ROOT/'work/usb-stock-recovery-20261104/goal/version-control-v2/left'

class VersionControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.manifest,cls.payload=inspect_build(BUILD)

    def test_transport_free_artifact_import(self):
        code="import sys;sys.modules['serial']=None;sys.modules['g2_case_rom']=None;from case_uart_version_control.artifacts import inspect_build"
        result=subprocess.run([sys.executable,'-c',code],cwd=ROOT/'scripts',capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_ready_frame_binds_route_and_fixed_request(self):
        raw=ready_bytes(self.manifest)
        self.assertTrue(parse_ready(raw,self.manifest)['valid'])
        with self.assertRaises(ValueError): parse_ready(raw,{**self.manifest,'route':'right'})
        with self.assertRaises(ValueError): parse_ready(raw[:-1],self.manifest)
        with self.assertRaises(ValueError): parse_ready(raw,{**self.manifest,'receiveMode':'early-armed'})

    def test_reset_capability_or_payload_changes_invalidate_artifacts(self):
        for kind in ['reset','packet','coverage','payload']:
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as name:
                d=Path(name);m=copy.deepcopy(self.manifest);payload=self.payload
                if kind=='reset':m['templeResetImplemented']=True
                elif kind=='packet':m['templeCommandAllowlist']=['14559de900000800']
                elif kind=='coverage':m['cases']=m['cases'][:-1]
                else:payload=payload[:-1]+bytes([payload[-1]^1])
                (d/'validated-manifest.json').write_text(json.dumps(m));(d/'bridge.bin').write_bytes(payload)
                with self.assertRaises(ValueError):inspect_build(d)

    def test_both_routes_use_exactly_one_five_byte_read_only_request(self):
        for route in ['left','right','left-early','right-early']:
            m,p=inspect_build(BUILD.parent/route)
            result=run(p,m['route'],1000000,m['profile'],1,'valid',receive_mode=m['receiveMode'])
            self.assertTrue(result['applicationVersionVerified'])
            self.assertEqual(result['templeBytesSent'],5)
            self.assertEqual(result['resetActions'],0)

    def test_early_receive_ack_and_overrun_configuration_are_required(self):
        m,p=inspect_build(BUILD.parent/'left-early')
        for fault,status in [('rx-not-ready',17),('overrun-config',16),('uart-overrun',9)]:
            r=run(p,'left',1000000,m['profile'],1,fault,receive_mode='early-armed')
            self.assertEqual(r['status'],status)
            self.assertFalse(r['applicationVersionVerified'])
            if fault!='uart-overrun':self.assertEqual(r['templeBytesSent'],0)

    def test_rechecksummed_result_cannot_change_receive_or_overrun_proof(self):
        from test_g2_sbl_reset_capture import RetainedTarget
        for name in ['left','left-early']:
            m,p=inspect_build(BUILD.parent/name)
            result=run(p,'left',1000000,m['profile'],1,'silence',receive_mode=m['receiveMode'],target=RetainedTarget())
            original=bytes.fromhex(result['retainedResultHex'])
            self.assertTrue(decode_result(original,m)['overrunDetectionConfigured'])
            for offset in [68,70,71]:
                data=bytearray(original);data[offset]^=1
                struct.pack_into('<I',data,252,fnv(data[:252]))
                with self.subTest(name=name,offset=offset),self.assertRaises(ValueError):decode_result(data,m)

    def test_pogo_body_matches_receiver_checksum_and_usb_frame_does_not(self):
        from case_uart_version_control.protocol import POGO_REQUESTS
        from g2_stock_case_diagnostics import VERSION_REQUESTS
        for side,body in POGO_REQUESTS.items():
            self.assertEqual(len(body),5)
            self.assertEqual(body[0],0x24)
            self.assertEqual((len(body)+0x7d+sum(body[:-1]))&255,body[-1])
            usb=VERSION_REQUESTS[side]
            self.assertNotEqual((len(usb)+0x7d+sum(usb[:-1]))&255,usb[-1])

    def test_echo_and_bad_checksum_never_qualify_the_receive_path(self):
        for fault in ['echo-only','bad-checksum','truncated','other-command']:
            r=run(self.payload,'left',1000000,self.manifest['profile'],1,fault)
            self.assertFalse(r['applicationVersionVerified'])

if __name__=='__main__':unittest.main()
