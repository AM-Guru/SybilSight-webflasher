#!/usr/bin/env python3
"""Execute pinned stock reset routine in a model, intercepting GPIO and delays.
No serial device is opened; this is sequence evidence, not physical timing proof.
"""
import hashlib,json,struct,sys
from pathlib import Path
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_MODE_MCLASS,UC_HOOK_CODE
from unicorn.arm_const import UC_CPU_ARM_CORTEX_M0,UC_ARM_REG_SP,UC_ARM_REG_LR,UC_ARM_REG_PC,UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2
p=Path('/Users/kalani/Repo/evenRealities-openCFW/g2/blobs/official/g2-2.2.6.10/firmware_box.bin');b=p.read_bytes()[32:]
assert hashlib.sha256(b).hexdigest()=='773b6d4cfdaf0a5a74a557e3babe8222a0ae813436b76a7437c1096d2c60d677'
u=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
u.mem_map(0x08000000,0x10000);u.mem_write(0x08000000,b);u.mem_map(0x20000000,0x24000)
trace=[]
def code(uc,a,size,ctx):
 if a==0x08004e9e:trace.append({'operation':'gpio','base':hex(u.reg_read(UC_ARM_REG_R0)),'mask':hex(u.reg_read(UC_ARM_REG_R1)),'high':u.reg_read(UC_ARM_REG_R2)!=0})
 elif a==0x0800a7b0:trace.append({'operation':'osDelay','ticks':u.reg_read(UC_ARM_REG_R0)})
 elif a==0x0800a7a2:trace.append({'operation':'nativeBusyDelay','iterations':u.reg_read(UC_ARM_REG_R0)})
 else:return
 u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
u.hook_add(UC_HOOK_CODE,code);u.reg_write(UC_ARM_REG_SP,0x20014000);u.reg_write(UC_ARM_REG_LR,0x20010001)
u.emu_start(0x0800b679,0x20010000,count=100000)
assert len(trace)==103,(len(trace),trace)
out={'caseCodeSha256':hashlib.sha256(b).hexdigest(),'entry':'0x0800B678','trace':trace,'boundary':'Stock reset sequence, not a new DFU entry trigger; modeled delays have not been physically measured.'}
Path(sys.argv[1]).write_text(json.dumps(out,indent=2)+'\n');print('Stock waveform actions',len(trace))
