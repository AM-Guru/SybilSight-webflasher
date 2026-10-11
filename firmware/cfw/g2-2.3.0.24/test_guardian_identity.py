"""Execute packaged Guardian settings, live-peer rendering and lease expiry."""
import struct
import unittest
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_CODE
from unicorn.arm_const import *
import test_keyboard_relay

class GuardianIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test_keyboard_relay.KeyboardRelayTests.setUpClass()
        cls.fixture = test_keyboard_relay.KeyboardRelayTests()

    def cpu(self):
        cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
        cpu.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M4)
        cpu.mem_map(0x300000,0x500000)
        import build_keyboard_relay as relay
        cpu.mem_write(relay.DELTA,self.fixture.image)
        cpu.mem_map(0x20000000,0x300000)
        return cpu

    def call(self, cpu, name, *args):
        cpu.reg_write(UC_ARM_REG_SP, 0x20280000)
        cpu.reg_write(UC_ARM_REG_LR, 0x300001)
        for r,v in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3],args): cpu.reg_write(r,v)
        cpu.emu_start(self.fixture.entry(name)|1,0x300000,count=3000000)
        self.assertEqual(cpu.reg_read(UC_ARM_REG_PC),0x300000)

    def control(self, cpu, enabled, record=None):
        payload = bytes([0x08,0x02,0x10,0x01,0x22,0x02,0x08,0x01,0xa2,0x08,0x04])+ (record or bytes([71,73,1,enabled]))
        cpu.mem_write(0x20100000,struct.pack('<4I',0,0x20101000,len(payload),0))
        cpu.mem_write(0x20101000,payload)
        stop = self.fixture.manifest['inheritedTargets']['PARENT_SETTINGS_DECODE'] & ~1
        handle=cpu.hook_add(UC_HOOK_CODE,lambda c,a,s,d: c.emu_stop() if a==stop else None)
        cpu.reg_write(UC_ARM_REG_R0,0x20100000)
        cpu.reg_write(UC_ARM_REG_SP,0x20280000)
        cpu.reg_write(UC_ARM_REG_LR,0x300001)
        cpu.emu_start(self.fixture.entry('keyboard_settings_decode')|1,0x300000,count=10000)
        self.assertEqual(cpu.reg_read(UC_ARM_REG_PC),stop)
        cpu.hook_del(handle)

    def tick(self,cpu,ms): cpu.mem_write(0x20077e4c,struct.pack('<I',ms))
    def deadline(self,cpu): return struct.unpack('<I',cpu.mem_read(0x2029f5b4,4))[0]

    def setup_dashboard(self,cpu,side):
        cpu.mem_write(0x2007836e,b'\x01')
        cpu.mem_write(0x20077804,struct.pack('<3I',1,2,0))
        cpu.mem_write(0x200784db,bytes([side]))
        cpu.mem_write(0x200775d8,struct.pack('<I',0x20102000))
        cpu.mem_write(0x20102054,b'\x01')
        cpu.mem_write(0x20073c30,bytes.fromhex('665544332211'))
        cpu.mem_write(0x20073c46,b'\x01')
        cpu.mem_write(0x20073c49,b'\x01')
        def stock(c,a,s,d):
            if a==0x47e316: c.reg_write(UC_ARM_REG_PC,c.reg_read(UC_ARM_REG_LR))
        cpu.hook_add(UC_HOOK_CODE,stock)

    def test_default_off_explicit_enable_disable_and_malformed_controls(self):
        cpu=self.cpu();self.tick(cpu,100)
        self.assertEqual(self.deadline(cpu),0)
        self.control(cpu,1);self.assertEqual(self.deadline(cpu),30100)
        self.control(cpu,0,bytes([71,73,2,0]));self.assertEqual(self.deadline(cpu),30100)
        self.control(cpu,0,bytes([71,73,1,2]));self.assertEqual(self.deadline(cpu),30100)
        self.control(cpu,0);self.assertEqual(self.deadline(cpu),0)

    def test_reboot_clears_lease_and_expiry_invalidates_dashboard_snapshot(self):
        cpu=self.cpu();self.tick(cpu,100);self.control(cpu,1)
        cpu.mem_write(0x2029f5b8,struct.pack('<I',1))
        cpu.mem_write(0x2029f5a4,struct.pack('<I',0x43534c31))
        self.tick(cpu,30100)
        target=self.fixture.manifest['inheritedTargets']['PARENT_DASHBOARD_QUEUE'] & ~1
        handle=cpu.hook_add(UC_HOOK_CODE,lambda c,a,s,d: c.emu_stop() if a==target else None)
        cpu.reg_write(UC_ARM_REG_SP,0x20280000)
        cpu.reg_write(UC_ARM_REG_R0,123)
        cpu.reg_write(UC_ARM_REG_R1,0x20100000)
        cpu.reg_write(UC_ARM_REG_R2,0x20101000)
        cpu.reg_write(UC_ARM_REG_R3,0xffffffff)
        cpu.reg_write(UC_ARM_REG_LR,0x300001)
        cpu.emu_start(self.fixture.entry('guardian_queue_get')|1,0x300000,count=1000)
        self.assertEqual(cpu.reg_read(UC_ARM_REG_PC),target)
        self.assertEqual(bytes(cpu.mem_read(0x2029f5a4,4)),bytes(4))
        self.assertEqual(cpu.reg_read(UC_ARM_REG_R0),123)
        self.assertEqual(cpu.reg_read(UC_ARM_REG_R3),0xffffffff)
        cpu.hook_del(handle)
        self.control(cpu,1)
        handle=cpu.hook_add(UC_HOOK_CODE,lambda c,a,s,d: c.emu_stop() if a==0x48dae6 else None)
        cpu.reg_write(UC_ARM_REG_SP,0x20280000)
        cpu.emu_start(self.fixture.entry('keyboard_heap_startup')|1,0x300000,count=1000)
        self.assertEqual(cpu.reg_read(UC_ARM_REG_PC),0x48dae6)
        self.assertEqual(bytes(cpu.mem_read(0x2029f5b4,8)),bytes(8))
        cpu.hook_del(handle)

    def test_live_address_two_separate_lens_lanes_and_expiry(self):
        for side,top in [(2,236),(1,264)]:
            cpu=self.cpu();self.setup_dashboard(cpu,side);self.tick(cpu,100)
            fb=0x20110000
            # Disabled overlay preserves stock pixels exactly.
            cpu.mem_write(fb,bytes([0x77])*153600)
            self.call(cpu,'guardian_overlay',fb)
            self.assertEqual(bytes(cpu.mem_read(fb,153600)),bytes([0x77])*153600)
            cpu.mem_write(fb,bytes(153600));self.control(cpu,1)
            self.call(cpu,'guardian_overlay',fb)
            pixels=bytes(cpu.mem_read(fb,153600))
            self.assertTrue(any(pixels[top*320:(top+24)*320]))
            self.assertFalse(any(pixels[236*320:top*320]))
            self.assertFalse(any(pixels[(top+24)*320:288*320]))
            self.assertEqual(bytes(cpu.mem_read(0x2029f5aa,6)),bytes.fromhex('665544332211'))
            self.tick(cpu,30100);cpu.mem_write(fb,bytes([0x33])*153600)
            self.call(cpu,'guardian_overlay',fb)
            self.assertEqual(bytes(cpu.mem_read(fb,153600)),bytes([0x33])*153600)
            self.assertEqual(struct.unpack('<I',cpu.mem_read(0x2029f5b8,4))[0],0)
            self.assertEqual(self.deadline(cpu),0)
            self.tick(cpu,0x80010000)
            self.call(cpu,'guardian_overlay',fb)
            self.assertEqual(bytes(cpu.mem_read(fb,153600)),bytes([0x33])*153600)

if __name__=='__main__': unittest.main()
