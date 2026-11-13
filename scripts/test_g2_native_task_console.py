from contextlib import contextmanager
import tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from case_native_task_flash.console_reset import checked_console,CASE_SERIAL,SafetyError

class ConsoleTests(unittest.TestCase):
    def run_fixture(self,proofs,*,send_reset=False,serial=CASE_SERIAL,confirmation=True):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);out=Path(tmp.name)/'capture';writes=[]
        class Port:
            def write(self,b):writes.append(b);return len(b)
            def flush(self):pass
            def reset_input_buffer(self):pass
            def read(self,n):return b'reset gls L & R, reason: cmd\r\n' if confirmation else b''
        @contextmanager
        def connect(*args):yield Port()
        text=f'****** B200 1.2.57 {serial}******\r\n'.encode()
        def invoke():
            with patch('case_native_task_flash.console_reset._open_case_console',connect),patch('case_native_task_flash.console_reset._drain_case_console',return_value=text),patch('case_native_task_flash.console_reset.parse_case_restore_evidence',side_effect=proofs):
                return checked_console('unused',out,send_reset=send_reset)
        return invoke,writes,out
    @staticmethod
    def proof(**changes):return {'case_version':'1.2.57','left_present':True,'right_present':True,'ota_glasses':0,**changes}
    def test_missing_telemetry_retries_queries_but_sends_reset_once(self):
        invoke,writes,out=self.run_fixture([SafetyError('fresh case temple-presence telemetry was not observed'),self.proof()],send_reset=True)
        r=invoke();self.assertEqual(r['queryRounds'],2);self.assertEqual(writes.count(b'DEB0\n'),1);self.assertTrue(r['reset_confirmed'])
    def test_actual_absence_is_not_retried_or_reset(self):
        invoke,writes,out=self.run_fixture([self.proof(right_present=False)],send_reset=True)
        with self.assertRaises(ValueError):invoke()
        self.assertEqual(len(writes),3);self.assertNotIn(b'DEB0\n',writes);self.assertTrue((out/'console.txt').exists())
    def test_wrong_identity_never_resets(self):
        invoke,writes,out=self.run_fixture([self.proof()],send_reset=True,serial='0'*24)
        with self.assertRaises(ValueError):invoke()
        self.assertNotIn(b'DEB0\n',writes)
    def test_active_ota_never_resets(self):
        invoke,writes,out=self.run_fixture([self.proof(ota_glasses=1)],send_reset=True)
        with self.assertRaises(ValueError):invoke()
        self.assertNotIn(b'DEB0\n',writes)
    def test_persistent_missing_telemetry_stops_after_three_query_rounds(self):
        invoke,writes,out=self.run_fixture([SafetyError('missing telemetry')]*3,send_reset=True)
        with self.assertRaises(SafetyError):invoke()
        self.assertEqual(len(writes),9);self.assertNotIn(b'DEB0\n',writes)
    def test_presence_only_does_not_send_reset(self):
        invoke,writes,out=self.run_fixture([self.proof()]);r=invoke()
        self.assertEqual(r['outcome'],'presence-only-verified');self.assertFalse(r['reset_sent']);self.assertNotIn(b'DEB0\n',writes)
        self.assertNotIn('reset_command',r)

if __name__=='__main__':unittest.main()
