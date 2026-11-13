import unittest
from case_native_task_flash.transaction import trial

class FakeCase:
    def __init__(self,fault=None):
        self.originals=(b'original-call-sites',b'original-guard-page')
        self.patched=(b'patched-call-sites',b'patched-guard-page')
        self.pages=list(self.originals);self.events=[];self.fault=fault
    def read_page(self,p):return self.pages[p]
    def write_page(self,p,mode):
        self.events.append(('write',p,mode))
        if self.fault==('write',p,mode):
            self.pages[p]=b'partial';raise RuntimeError('uncertain operation; no retry')
        self.pages[p]=(self.originals if mode else self.patched)[p]
    def observe_context(self):
        self.events.append(('context',))
        if self.fault=='context':raise RuntimeError('no valid context')
        return {'status':0}
    def verify_stock(self):
        self.events.append(('verify-stock',))
        if self.fault=='stock-outside-pages':raise RuntimeError('other stock bytes changed')
        if tuple(self.pages)!=self.originals:raise RuntimeError('original stock missing')
    def restore_sram(self):
        self.events.append(('restore-sram',))
        if self.fault=='sram':raise RuntimeError('SRAM restore failed')
    def boot_stock(self):self.events.append(('boot-stock',))
    def hold_rom(self):self.events.append(('hold-rom',))

class TransactionTests(unittest.TestCase):
    def run_case(self,fault=None):
        io=FakeCase(fault);return io,trial(io,io.originals,io.patched)
    def test_success_restores_in_reverse_order_before_normal_boot(self):
        io,r=self.run_case()
        self.assertEqual([e for e in io.events if e[0]=='write'],[('write',1,0),('write',0,0),('write',0,1),('write',1,1)])
        self.assertTrue(r['stockBooted'] and r['sramRestored'] and r['fullStockVerified'])
        self.assertEqual(io.events[-1],('boot-stock',))
    def test_uncertain_guard_patch_is_not_retried_and_is_restored(self):
        io,r=self.run_case(('write',1,0))
        self.assertEqual([e for e in io.events if e[0]=='write'],[('write',1,0),('write',1,1)])
        self.assertIsNone(r['context']);self.assertTrue(r['stockBooted'])
    def test_uncertain_call_site_patch_restores_both_before_boot(self):
        io,r=self.run_case(('write',0,0))
        self.assertEqual([e for e in io.events if e[0]=='write'],[('write',1,0),('write',0,0),('write',0,1),('write',1,1)])
        self.assertTrue(r['stockBooted']);self.assertIsNotNone(r['error'])
    def test_context_error_still_restores_stock(self):
        io,r=self.run_case('context');self.assertTrue(r['fullStockVerified'] and r['stockBooted'])
    def test_failed_call_site_restore_keeps_guard_and_never_boots(self):
        io,r=self.run_case(('write',0,1))
        self.assertEqual(io.pages[1],io.patched[1]);self.assertFalse(r['stockBooted'])
        self.assertNotIn(('write',1,1),io.events);self.assertEqual(io.events[-1],('hold-rom',))
    def test_unknown_preexisting_bytes_are_not_overwritten(self):
        io=FakeCase();io.pages[0]=b'unrelated'
        r=trial(io,io.originals,io.patched)
        self.assertFalse(r['stockBooted']);self.assertFalse(any(e[0]=='write' for e in io.events))
    def test_outside_stock_mismatch_prevents_boot(self):
        io,r=self.run_case('stock-outside-pages');self.assertTrue(r['pagesRestored']);self.assertFalse(r['stockBooted'])
    def test_sram_failure_is_reported_but_verified_stock_can_boot(self):
        io,r=self.run_case('sram');self.assertFalse(r['sramRestored']);self.assertTrue(r['stockBooted'])
    def test_restore_only_accepts_partial_pages_without_context_boot(self):
        io=FakeCase();io.pages=[b'partial',b'partial'];r=trial(io,io.originals,io.patched,restore_only=True)
        self.assertTrue(r['stockBooted']);self.assertNotIn(('context',),io.events)
        self.assertEqual([e for e in io.events if e[0]=='write'],[('write',0,1),('write',1,1)])

if __name__=='__main__':unittest.main()
