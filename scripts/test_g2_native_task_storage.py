import unittest
from contextlib import contextmanager
from unittest.mock import patch
from case_native_task_recovery import rom_epochs as e
from case_native_task_recovery import qualify_storage as q
from g2_case_rom import BootloaderError

class StorageTests(unittest.TestCase):
    def test_reads_use_bounded_fresh_sessions(self):
        sessions=[]
        @contextmanager
        def connect(*a):sessions.append(object());yield sessions[-1]
        def read(port,address,size,attempts):return bytes((address+i)&255 for i in range(size))
        with patch.object(e,'bound_rom',connect),patch.object(e,'read_memory',read):
            data=e.read_fresh('device','serial',0x8000000,10010)
        self.assertEqual(len(sessions),3);self.assertEqual(data,bytes(i&255 for i in range(10010)))

    def test_failed_epoch_prefix_is_discarded_and_fresh_object_used(self):
        sessions=[]
        @contextmanager
        def connect(*a):sessions.append(object());yield sessions[-1]
        def read(port,address,size,attempts):
            if port is sessions[0]:
                if address>=0x800003e:raise BootloaderError('injected short reply')
                return b'X'*size
            return bytes((address+i)&255 for i in range(size))
        with patch.object(e,'bound_rom',connect),patch.object(e,'read_memory',read):
            data=e.read_fresh('device','serial',0x8000000,128)
        self.assertEqual(len(sessions),2);self.assertEqual(data,bytes(range(128)))

    def test_identity_mismatch_is_not_retried(self):
        with patch.object(e,'bound_rom',side_effect=ValueError('UID mismatch')) as connect:
            with self.assertRaises(ValueError):e.read_fresh('d','s',0x8000000,128)
        self.assertEqual(connect.call_count,1)

    def test_unbounded_read_or_wrong_sram_span_rejected_before_io(self):
        with patch.object(e,'bound_rom') as connect:
            for options in [{'epoch_bytes':8193},{'attempts':3}]:
                with self.assertRaises(ValueError):e.read_fresh('d','s',0x8000000,128,**options)
            connect.assert_not_called()
        with patch.object(q,'write_sram') as write:
            for addr,data in [(q.BASE-4,b'1234'),(q.BASE+q.SIZE,b'1234'),(q.BASE,b'123'),(q.BASE+1,b'1234')]:
                with self.assertRaises(ValueError):q.put(None,addr,data)
            write.assert_not_called()

if __name__=='__main__':unittest.main()
