#!/usr/bin/env python3
"""Execute the compiled sensing bridge with modeled YHM/ADC fault injection.

This validates bridge control flow and restoration; it is not hardware proof.
"""
import hashlib, json, struct, sys
from pathlib import Path
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_CODE, UC_HOOK_MEM_READ, UC_HOOK_MEM_WRITE
from unicorn.arm_const import UC_ARM_REG_SP, UC_ARM_REG_PC, UC_ARM_REG_LR, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_CPU_ARM_CORTEX_M0

BASE=0x20010000; RESULT=0x20011a00; ADC=0x40012400; SIZE=536
def fnv(data):
 h=2166136261
 for b in data:h=((h^b)*16777619)&0xffffffff
 return h

def run(payload, fault="none", baseline=None):
 u=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
 for addr,size in ((0x08000000,0x10000),(0x20000000,0x24000),(0x40000000,0x30000),(0xe000e000,0x2000)):
  u.mem_map(addr,size)
 u.mem_write(BASE,payload)
 regs=bytearray(baseline or bytes.fromhex('811104afaf03812033ff'))
 if fault=='unexpected':regs[6]=0x8d
 original=bytes(regs);writes=[];injected=False;sample_index=0;finished=False
 init={0x08004eec,0x08008438,0x08006a40,0x08002888,0x08002cb8}
 def ret(value=0):u.reg_write(UC_ARM_REG_R0,value);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
 def code(uc,addr,size,ctx):
  nonlocal injected
  if addr in init:ret()
  elif addr==0x080068f0:
   if fault=='init':u.mem_write(0x20000940,struct.pack('<I',1))
   ret()
  elif addr==0x08009040:
   idx=u.reg_read(UC_ARM_REG_R0);assert 0<=idx<10
   dest=u.reg_read(UC_ARM_REG_R2)
   bad=(fault=='baseline_read' and not writes and idx==8) or (fault=='selected_read' and writes and not injected)
   if bad:injected=True;ret(0)
   else:u.mem_write(dest,bytes([regs[idx]]));ret(1)
  elif addr==0x08009108:
   idx=u.reg_read(UC_ARM_REG_R0);assert idx in (3,4,5,6)
   assert u.reg_read(UC_ARM_REG_R1)==1
   value=u.mem_read(u.reg_read(UC_ARM_REG_R2),1)[0]
   writes.append((idx,value))
   assert value==original[idx] or (idx==5 and value==3) or (idx in (3,4) and value==0xaf) or (idx==6 and value in (0x8b,0x8d))
   bad=(fault=='write' and not injected) or (fault=='restore' and idx==6 and value==original[6])
   if bad:injected=True;ret(0)
   else:regs[idx]=value;ret(1)
  elif addr<0x08010000:raise AssertionError(f'unexpected native call {addr:x}')
 def read(uc,access,addr,size,value,ctx):
  nonlocal sample_index
  if addr==ADC:
   status=0 if fault=='ready' else 1 if fault=='eoc' else 5
   u.mem_write(addr,struct.pack('<I',status))
  elif addr==ADC+8:
   state=0x15 if fault=='stop' else 0
   u.mem_write(addr,struct.pack('<I',state))
  elif addr==ADC+0x40:
   value=5000 if fault=='overflow' else (100 if regs[6]==0x8b else 200)+(sample_index%8)
   sample_index+=1;u.mem_write(addr,struct.pack('<I',value))
 def write(uc,access,addr,size,value,ctx):
  nonlocal finished
  assert 0x20000000<=addr<0x20024000 or addr in (ADC,ADC+8,0x40003000,0x40021034,0xe000e010,0xe000e180,0xe000e280),hex(addr)
  if addr==RESULT+SIZE-4 and bytes(u.mem_read(RESULT,4))==b'SNS1':
   u.mem_write(addr,struct.pack('<I',value));finished=True;u.emu_stop()
 u.hook_add(UC_HOOK_CODE,code)
 u.hook_add(UC_HOOK_MEM_READ,read)
 u.hook_add(UC_HOOK_MEM_WRITE,write)
 sp,entry=struct.unpack_from('<II',payload)
 u.reg_write(UC_ARM_REG_SP,sp)
 u.emu_start(entry,0,count=25000000)
 assert finished,'bridge did not terminate within instruction budget'
 data=bytes(u.mem_read(RESULT,SIZE));words=struct.unpack_from('<12I',data)
 assert words[0]==0x31534e53 and fnv(data[:-4])==struct.unpack_from('<I',data,SIZE-4)[0]
 if fault=='none':
  assert words[2]==0 and words[3]==10 and words[5]==words[6]==0x3ff
  assert data[48:58]==data[58:68]==original
  assert struct.unpack_from('<10I',data,392)==tuple(103 if i%2==0 else 203 for i in range(10))
 elif fault in ('unexpected','baseline_read'):
  assert words[2]==1 and not writes
 elif fault=='init':assert words[2]==6 and not writes and words[6]==0x3ff
 elif fault=='restore':assert words[2]==5 and words[8]!=0
 else:
  assert words[2] in (2,3,4) and words[3]==0 and words[6]==0x3ff
  assert bytes(regs)==original and data[48:58]==data[58:68]
 return {'fault':fault,'status':words[2],'phases':words[3],'writes':len(writes),'checksumVerified':True}

def main():
 build=Path(sys.argv[1]);payload=(build/'bridge.bin').read_bytes()
 cases=[run(payload,f) for f in ('none','unexpected','baseline_read','init','write','selected_read','ready','eoc','overflow','stop','restore')]
 cases.append(run(payload,baseline=bytes.fromhex('811104afaf03812022ff')))
 source=Path(__file__).parent
 manifest={'schemaVersion':1,'payloadSha256':hashlib.sha256(payload).hexdigest(),'payloadBytes':len(payload),'sourceHashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (source/'bridge.c',source/'start.S',source/'link.ld',source/'validate.py')},'validation':'compiled ARM bridge executed with modeled peripheral fault injection','hardwareProof':False,'cases':cases}
 (build/'validated-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print(json.dumps(manifest,indent=2))
if __name__=='__main__':main()
