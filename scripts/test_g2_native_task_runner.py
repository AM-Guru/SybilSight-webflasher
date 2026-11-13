"""Host boundary fixtures; these do not model the physical flash controller."""
from contextlib import contextmanager
import json,struct,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from case_native_task_flash.run_native import CaseBackend,BASE
from case_native_task_recovery.protocol import configuration
from case_sbl_reset_prepared.trace import fnv
from g2_case_rom import BootloaderError

class RunnerTests(unittest.TestCase):
    def fixture(self,wrong_nonce=False):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);root=Path(tmp.name)
        reference=root/'reference';reference.write_bytes(bytes(32)+b'stock')
        report={'pageOperations':[]}
        pages=[[b'A'*2048,b'B'*2048],[b'C'*2048,b'D'*2048]]
        io=CaseBackend(SimpleNamespace(output=root,device='unused',case_reference=reference),report,b'writer',pages,{},bytes(32768),{}, {})
        captured={}
        def stage(payload,cfg):captured['cfg']=cfg
        io.loader.stage_writer=stage;io.loader.stage_context=stage
        @contextmanager
        def connect(**kw):
            self.assertEqual(kw['expected'],captured['cfg']);yield SimpleNamespace(dtr=False)
        io.loader.connect=connect
        def read(address,size):
            if address==BASE:return io.writer
            if address==0x20013f00 and size==8:return bytes(8)
            if address==0x08009800:return pages[0][1]
            if address==0x20013a00:
                cfg=struct.unpack('<8I',captured['cfg']);w=[0]*64
                w[:10]=[0x31574647,10,0,100,0x08009800,0,(cfg[5]+int(wrong_nonce))&0xffffffff,fnv(pages[0][0]),fnv(pages[0][1]),fnv(pages[0][1])]
                w[10:13]=[1,256,1];w[15]=0xc0000000
                raw=struct.pack('<64I',*w);w[63]=fnv(raw[:252]);return struct.pack('<64I',*w)
            raise AssertionError((address,size))
        io.read=read
        def verify(address,expected,label):self.assertEqual(io.read(address,len(expected)),expected)
        io.verify=verify
        return io,report

    def test_lost_go_ack_is_resolved_from_nonce_and_page_without_replay(self):
        io,r=self.fixture()
        with patch('case_native_task_flash.run_native.go_sram',side_effect=BootloaderError('lost ACK')) as go,patch('case_native_task_flash.run_native.time.sleep'):
            io.write_page(0,0)
        self.assertEqual(go.call_count,1);self.assertFalse(r['pageOperations'][0]['goAcknowledged'])
        self.assertEqual(r['pageOperations'][0]['stage'],'exact-page-and-mirrors-verified')

    def test_stale_valid_checksum_nonce_is_rejected_without_second_go(self):
        io,r=self.fixture(wrong_nonce=True)
        with patch('case_native_task_flash.run_native.go_sram') as go,patch('case_native_task_flash.run_native.time.sleep'):
            with self.assertRaises(ValueError):io.write_page(0,0)
        self.assertEqual(go.call_count,1)

    def test_context_uses_exactly_one_explicit_reset_and_requires_native_evidence(self):
        io,r=self.fixture();io.a.route='left'
        io.context={'patched-case':b'patched-case','hook':b'hook'};cfg=configuration('left',1000000,123)
        w=[0]*64;w[:8]=[0x3143544e,9,0,3,0x08009aff,0,64,123]
        w[10:16]=[2,2,1000,1062,1,1];raw=struct.pack('<64I',*w);w[63]=fnv(raw[:252]);raw=struct.pack('<64I',*w)
        def retained(address,size):
            if address==0x08000000:return io.context['patched-case']
            if address==BASE:return io.context['hook']
            if address==0x20011f00:return cfg if size==32 else bytes(8)
            if address==0x20011a00:return raw
            raise AssertionError((address,size))
        io.read=retained
        reset={'reset_confirmed':True,'case_version':'1.2.57','left_present':True,'right_present':True}
        with patch('case_native_task_flash.run_native.secrets.randbits',return_value=123),patch('case_native_task_flash.run_native.checked_console',return_value=reset) as command,patch('case_native_task_flash.run_native.time.sleep'):
            result=io.observe_context()
        self.assertEqual(command.call_count,1);self.assertEqual(result['halTickDelta'],62)

if __name__=='__main__':unittest.main()
