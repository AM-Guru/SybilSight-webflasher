import json,os,shutil,tempfile,unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
from case_native_task_flash.build import load_pages,sha
from case_native_task_flash.artifacts import inspect
from case_native_task_flash.qualify import put_all
from case_native_task_flash.protocol import request,decode
from g2_case_rom import BootloaderError

class WriterArtifactTests(unittest.TestCase):
    def setUp(self):
        keys=('G2_NATIVE_FLASH_BUILD','G2_NATIVE_FLASH_PLAN','G2_NATIVE_TASK_BUILD','G2_NATIVE_TASK_REFERENCE')
        if not all(os.environ.get(k) for k in keys):self.skipTest('explicit compiled writer and context artifacts required')
        self.build,self.plan,self.context,self.reference=[Path(os.environ[k]) for k in keys]
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)

    def test_validated_writer_is_accepted(self):
        m,p,pages=inspect(self.build,self.plan,self.context,self.reference)
        self.assertTrue(m['passed']);self.assertEqual(len(pages),2);self.assertEqual(len(p),9264)

    def test_tampered_page_rejected_even_with_changed_digest(self):
        plan=self.root/'plan';shutil.copytree(self.plan,plan)
        path=plan/'plan.json';r=json.loads(path.read_text());name=r['pages'][0]['patchedFile']
        data=bytearray((plan/name).read_bytes());data[0]^=1;(plan/name).write_bytes(data)
        r['pages'][0]['patchedSha256']=sha(data);path.write_text(json.dumps(r))
        with self.assertRaises(ValueError):load_pages(plan,self.context,self.reference)

    def test_coverage_missing_rejected(self):
        build=self.root/'build';shutil.copytree(self.build,build)
        p=build/'validated-writer.json';r=json.loads(p.read_text());r['cases'].pop();p.write_text(json.dumps(r))
        with self.assertRaises(ValueError):inspect(build,self.plan,self.context,self.reference)

    def test_qualification_rejects_nonfixed_sram_size_before_io(self):
        with patch('case_native_task_flash.qualify.bound_rom') as connect:
            with self.assertRaises(ValueError):put_all('unused',bytes(4))
            connect.assert_not_called()

    def test_request_rejects_unscoped_parameters(self):
        for args in ((2,0,1),(0,3,1),(0,0,0),(0,0,2**32)):
            with self.assertRaises(ValueError):request(*args)

    def test_result_requires_checksums_and_success_context(self):
        with self.assertRaises(ValueError):decode(bytes(256))
        with self.assertRaises(ValueError):decode(bytes(32))

    def test_sram_retry_replays_exact_epoch_on_fresh_transport(self):
        sessions=[];memory={};writes=[]
        @contextmanager
        def connect(*a):
            sessions.append(object());yield sessions[-1]
        def write(port,address,data):
            writes.append((port,address,data))
            if port is sessions[0] and address==0x20010200:raise BootloaderError('injected missing SRAM ACK')
            for i,b in enumerate(data):memory[address+i]=b
        def read(port,address,size,attempts):return bytes(memory[address+i] for i in range(size))
        image=bytes(range(256))*128
        with patch('case_native_task_flash.qualify.bound_rom',connect),patch('case_native_task_flash.qualify.write_sram',write),patch('case_native_task_flash.qualify.read_memory',read):
            put_all('unused',image)
        self.assertEqual(len(sessions),33)
        self.assertEqual(bytes(memory[0x20010000+i] for i in range(len(image))),image)
        self.assertEqual(next(a for p,a,d in writes if p is sessions[1]),0x20010000)

    def test_identity_failure_is_not_retried_for_sram_upload(self):
        with patch('case_native_task_flash.qualify.bound_rom',side_effect=ValueError('UID mismatch')) as connect,patch('case_native_task_flash.qualify.write_sram') as write:
            with self.assertRaises(ValueError):put_all('unused',bytes(32768))
            self.assertEqual(connect.call_count,1);write.assert_not_called()

if __name__=='__main__':unittest.main()
