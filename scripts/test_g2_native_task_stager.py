from contextlib import contextmanager
import struct,unittest
from unittest.mock import patch
from case_native_task_flash.stager import Stager,BASE,SIZE
from case_native_task_flash.protocol import request
from case_native_task_recovery.protocol import configuration
from g2_case_rom import BootloaderError

class StagerTests(unittest.TestCase):
    def fake(self):
        data=bytearray(SIZE);sessions=[];writes=[]
        @contextmanager
        def connect(*args):sessions.append(object());yield sessions[-1]
        def read(p,a,n,attempts):return bytes(data[a-BASE:a-BASE+n])
        def write(p,a,b):writes.append((a,b));data[a-BASE:a-BASE+len(b)]=b
        return data,sessions,writes,connect,read,write
    def test_restage_unchanged_writer_writes_only_changed_result_config(self):
        data,sessions,writes,connect,read,write=self.fake();s=Stager('unused')
        payload=struct.pack('<II',0x20018000,0x20010009)+b'W'*2040
        with patch('case_native_task_flash.stager.bound_rom',connect),patch('case_native_task_flash.stager.read_memory',read),patch('case_native_task_flash.stager.write_sram',write):
            s.stage_writer(payload,request(0,2,1));first=s.bytes_written
            data[0x3a00:0x3b00]=b'E'*256
            s.stage_writer(payload,request(1,2,2))
        self.assertEqual(s.bytes_written-first,288)
        self.assertTrue(all(BASE<=a<a+len(b)<=BASE+SIZE for a,b in writes))
    def test_context_writes_only_three_spans(self):
        data,sessions,writes,connect,read,write=self.fake();s=Stager('unused')
        with patch('case_native_task_flash.stager.bound_rom',connect),patch('case_native_task_flash.stager.read_memory',read),patch('case_native_task_flash.stager.write_sram',write):s.stage_context(b'H'*484,configuration('left',1000000,1))
        self.assertEqual(s.bytes_written,516)
        self.assertEqual(data[:484],b'H'*484);self.assertEqual(data[484:0x1f00],bytes(0x1f00-484))
    def test_bad_inputs_rejected_before_io(self):
        s=Stager('unused')
        with patch('case_native_task_flash.stager.bound_rom') as connect:
            for a,b in ((BASE-4,b'ABCD'),(BASE+SIZE,b'ABCD'),(BASE+1,b'ABCD'),(BASE,b'ABC')):
                with self.assertRaises(ValueError):s._patch(a,b)
            with self.assertRaises(ValueError):s.stage_writer(b'W'*100,request(0,2,1))
            with self.assertRaises(ValueError):s.stage_context(b'H'*484,bytes(32))
            connect.assert_not_called()
    def test_identity_failure_not_retried(self):
        with patch('case_native_task_flash.stager.bound_rom',side_effect=ValueError('UID mismatch')) as connect:
            with self.assertRaises(ValueError):Stager('unused').read(BASE,32)
            self.assertEqual(connect.call_count,1)
    def test_body_failure_is_not_replayed(self):
        data,sessions,writes,connect,read,write=self.fake();calls=[]
        with patch('case_native_task_flash.stager.bound_rom',connect):
            with self.assertRaises(BootloaderError):
                with Stager('unused').connect():calls.append('GO');raise BootloaderError('lost ACK after GO')
        self.assertEqual(calls,['GO']);self.assertEqual(len(sessions),1)
    def test_sync_failure_before_body_retries_fresh_connection(self):
        attempts=[]
        @contextmanager
        def connect(*args):
            attempts.append(len(attempts))
            if len(attempts)<3:raise BootloaderError('sync ACK timeout')
            yield object()
        with patch('case_native_task_flash.stager.bound_rom',connect),patch('case_native_task_flash.stager.time.sleep'):
            with Stager('unused').connect():pass
        self.assertEqual(len(attempts),3)
    def test_partial_sram_write_can_resume_by_exact_comparison(self):
        data,sessions,writes,connect,read,write=self.fake();failed=[]
        def unstable(p,a,b):
            write(p,a,b)
            if not failed:failed.append(True);raise BootloaderError('lost SRAM ACK')
        with patch('case_native_task_flash.stager.bound_rom',connect),patch('case_native_task_flash.stager.read_memory',read),patch('case_native_task_flash.stager.write_sram',unstable),patch('case_native_task_flash.stager.time.sleep'):
            Stager('unused')._patch(BASE,b'X'*1024)
        self.assertEqual(data[:1024],b'X'*1024);self.assertEqual(len(sessions),2)
    def test_known_read_mismatch_is_bounded_and_uid_errors_not_hidden(self):
        data,sessions,writes,connect,read,write=self.fake()
        with patch('case_native_task_flash.stager.bound_rom',connect),patch('case_native_task_flash.stager.read_memory',read),patch('case_native_task_flash.stager.time.sleep'):
            with self.assertRaises(BootloaderError):Stager('unused').verify(BASE,b'X'*32)
        self.assertEqual(len(sessions),3);self.assertFalse(writes)
    def test_restore_rewrites_only_changed_epochs_then_verifies_entire_snapshot(self):
        data,sessions,writes,connect,read,write=self.fake();data[7000]=1;data[-1]=2;s=Stager('unused')
        with patch('case_native_task_flash.stager.bound_rom',connect),patch('case_native_task_flash.stager.read_memory',read),patch('case_native_task_flash.stager.write_sram',write):s.restore(bytes(SIZE))
        self.assertEqual(data,bytes(SIZE));self.assertEqual(s.bytes_written,2048)

if __name__=='__main__':unittest.main()
