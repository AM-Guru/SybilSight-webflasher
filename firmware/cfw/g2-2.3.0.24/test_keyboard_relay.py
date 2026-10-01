"""Offline regression gate for the additive revision-39 keyboard port."""
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import unittest
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import *
import build_keyboard_relay as relay

ART = Path(os.environ.get("G2_KEYBOARD_ARTIFACT", str(relay.ROOT / "artifacts/cfw-2.3.0.24/keyboard-relay")))
ARCHIVE = relay.ROOT.parent / "SybilSight-webflasher/public/firmware-updates/source-files"

def function(text, name):
    match = re.search(r"(?:__attribute__\(\(used\)\) )?static [^\n]+\b" + name + r"\([^\n]+\) \{", text)
    if not match: raise ValueError(name)
    start = match.start()
    end = text.index("{", start)
    depth = 1
    end += 1
    while depth:
        depth += (text[end] == "{") - (text[end] == "}")
        end += 1
    return text[start:end]

class KeyboardRelayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ART / "keyboard-relay-manifest.json").read_text())
        cls.image = (ART / "g2-2.3.0.24-keyboard-relay-experimental.bin").read_bytes()
        cls.recipe = json.loads((ART / "keyboard-relay-patches.json").read_text())

    def cpu(self):
        cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        cpu.mem_map(0x300000, 0x500000)
        cpu.mem_write(relay.DELTA, self.image)
        cpu.mem_map(0x20000000, 0x300000)
        cpu.reg_write(UC_ARM_REG_SP, 0x20280000)
        cpu.reg_write(UC_ARM_REG_LR, 0x300001)
        return cpu

    def entry(self, name):
        return self.manifest["injectedBase"] + self.manifest["functions"][name]

    def test_parent_replay_and_all_non_main_components_are_preserved(self):
        stock = relay.checked_file(ARCHIVE / "2.3.0.24/1dbdf37b03a1169c384945e94d671371.bin", relay.STOCK_SHA)
        parent_dir = ARCHIVE / "2.3.0.24-afa6c1da6bc1"
        if not parent_dir.exists():
            parent_dir = ARCHIVE.parents[2] / "work/retired-cfw/2.3.0.24-afa6c1da6bc1"
        parent = relay.checked_file(parent_dir / "g2-2.3.0.24-sybilsight-230.84.bin", relay.PARENT_SHA)
        original = json.loads((parent_dir / "cfw_patches-230.84.json").read_text())
        self.assertEqual(self.recipe["patches"][:len(original["patches"])], original["patches"])
        self.assertEqual(relay.apply_recipe(stock, self.recipe), self.image)
        self.assertEqual(relay.components(parent)[:-1], relay.components(self.image)[:-1])
        self.assertEqual(relay.sha(self.image), self.manifest["outputSha256"])
        blob = next(p for p in original["patches"] if not p["old"])
        inherited = parent[blob["offset"]:]
        self.assertEqual(self.image[blob["offset"]:len(parent)].replace(b"SybilSight/230.85", b"SybilSight/230.84"), inherited)
        self.assertFalse(self.recipe["hardware_validation"]["validated"])
        self.assertEqual(self.recipe["source_provenance"]["keyboard_contract"], 1)

    def test_stock_abi_guards_reject_a_changed_hook(self):
        stock = bytearray(relay.checked_file(ARCHIVE / "2.3.0.24/1dbdf37b03a1169c384945e94d671371.bin", relay.STOCK_SHA))
        relay.validate_sources_and_abi(stock)
        guard = json.loads((relay.SOURCE / "review.json").read_text())["guards"][0]
        stock[int(guard["address"], 16) - relay.DELTA] ^= 1
        with self.assertRaisesRegex(ValueError, "Stock ABI guard"):
            relay.validate_sources_and_abi(stock)

    def test_actual_startup_hook_clears_both_contexts_but_preserves_dashboard(self):
        cpu = self.cpu()
        address = 0x2029F59C
        cpu.mem_write(address, struct.pack("<6I", 0x20100000, 31, 32, 33, 34, 0x20101000))
        reached = []
        def stop_at_stock(cpu, at, size, data):
            if at == 0x48DAE6:
                reached.append(at)
                cpu.emu_stop()
        cpu.hook_add(UC_HOOK_CODE, stop_at_stock)
        cpu.emu_start(relay.HEAP_SITE | 1, 0x300000, count=300)
        self.assertEqual(reached, [0x48DAE6])
        self.assertEqual(struct.unpack("<6I", cpu.mem_read(address, 24)), (0,31,32,33,34,0))

    def test_actual_dispatch_hook_has_allocation_free_dormant_passthrough(self):
        cpu = self.cpu()
        values = [0x20100000, 0x11223344, 0x55667788]
        for register, value in zip([UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2], values): cpu.reg_write(register, value)
        cpu.emu_start(0x4CC1EC | 1, 0x4CC1F0, count=300)
        self.assertEqual(cpu.reg_read(UC_ARM_REG_PC), 0x4CC1F0)
        self.assertEqual(cpu.reg_read(UC_ARM_REG_SP), 0x20280000 - 32)
        self.assertEqual([cpu.reg_read(r) for r in [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2]], values)

    def test_actual_smp_hooks_preserve_stock_io_capability_and_registers(self):
        for site in [0x60093E,0x601298]:
            cpu = self.cpu()
            registers = [UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R3,UC_ARM_REG_R4,UC_ARM_REG_R12]
            values = [19,0x20100000,23,27,29]
            for r,v in zip(registers,values): cpu.reg_write(r,v)
            cpu.reg_write(UC_ARM_REG_R5, 0x20100100)
            cpu.mem_write(0x20100000, struct.pack("<I", 0x20100200))
            cpu.mem_write(0x20100204, b"\x03")
            cpu.emu_start(site | 1, site + 4, count=300)
            self.assertEqual(cpu.reg_read(UC_ARM_REG_PC), site + 4)
            self.assertEqual(cpu.reg_read(UC_ARM_REG_R2), 3)
            self.assertEqual([cpu.reg_read(r) for r in registers], values)
            self.assertEqual(cpu.reg_read(UC_ARM_REG_SP), 0x20280000)

    def test_keyboard_state_machine_with_address_and_undefined_behavior_sanitizers(self):
        source = relay.SOURCE / "upstream"
        text = (source / "keyboard.c").read_text()
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            (temporary / "keyboard_timer_functions.inc").write_text("\n".join(function(text,n) for n in ["kb_kick","kb_schedule","kb_tick"]))
            executable = temporary / "keyboard-host"
            subprocess.run(["clang","-std=c11","-O1","-g","-Wall","-Wextra","-Wno-unused-function",
                "-fsanitize=address,undefined","-I"+str(source),"-I"+str(temporary),
                str(source / "keyboard_host_test.c"),"-o",str(executable)],check=True,capture_output=True)
            subprocess.run([str(executable)],check=True,capture_output=True)

    def test_settings_scanner_bounds_malformed_fields_and_only_routes_field_130(self):
        text = (relay.SOURCE / "relay.c").read_text()
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            source = temporary / "scanner.c"
            source.write_text("""#include <assert.h>
#include <stdint.h>
static unsigned calls;
static void keyboard_apply_control(const uint8_t *p, uint32_t n) {
    assert(p && n <= 256); calls++;
}
""" + "\n".join(function(text,n) for n in ["keyboard_read_varint","keyboard_scan_settings"]) + """
int main(void) {
    uint8_t valid[] = {8,3,0x92,8,8,'K','B',1,1,0,0,0,0};
    keyboard_scan_settings(valid,sizeof(valid)); assert(calls==1);
    valid[2]=0x9a; keyboard_scan_settings(valid,sizeof(valid)); assert(calls==1);
    uint8_t truncated[] = {0x92,8,255,255,255,255,15};
    keyboard_scan_settings(truncated,sizeof(truncated)); assert(calls==1);
    uint32_t state=39; uint8_t bytes[256];
    for (unsigned i=0;i<20000;i++) {
        unsigned size=i%257;
        for (unsigned j=0;j<size;j++) { state=state*1664525u+1013904223u; bytes[j]=state>>24; }
        keyboard_scan_settings(bytes,size);
    }
    return 0;
}
""")
            executable = temporary / "scanner"
            subprocess.run(["clang","-std=c11","-O1","-g","-fsanitize=address,undefined",
                str(source),"-o",str(executable)],check=True,capture_output=True)
            subprocess.run([str(executable)],check=True,capture_output=True)

if __name__ == "__main__": unittest.main()
