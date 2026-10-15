#!/usr/bin/env python3
"""Model-check qualification only; no serial or hardware calibration claim."""
import hashlib,json,struct,sys
from pathlib import Path
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_MODE_MCLASS,UC_HOOK_CODE,UC_HOOK_MEM_WRITE
from unicorn.arm_const import UC_CPU_ARM_CORTEX_M0,UC_ARM_REG_SP,UC_ARM_REG_PC,UC_ARM_REG_LR,UC_ARM_REG_R0,UC_ARM_REG_R2
BASE=0x20010000;RESULT=0x20011a00;SIZE=256
def fnv(data):
 h=2166136261
 for b in data:h=((h^b)*16777619)&0xffffffff
 return h

def run(payload,fault):
 u=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
 for a,s in [(0x08000000,0x10000),(0x20000000,0x24000),(0x40000000,0x30000),(0x50000000,0x2000),(0xe000e000,0x2000)]:u.mem_map(a,s)
 u.mem_write(BASE,payload);reads=0;finished=False;uart=False
 initial=bytes.fromhex('811104afaf03812033ff')
 def ret(v=0):u.reg_write(UC_ARM_REG_R0,v);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
 def code(uc,a,s,ctx):
  nonlocal reads,uart
  if a in [0x08004eec,0x08008438,0x08006a40,0x08002888,0x08002cb8]:ret()
  elif a==0x08006cf8:uart=True;ret()
  elif a==0x08009040:
   idx=u.reg_read(UC_ARM_REG_R0);assert idx<10
   v=initial[idx];ok=1
   if fault=='unknown' and idx==6:v=0x8d
   if fault=='baseline_read' and reads<10 and idx==8:ok=0
   if fault=='post_read' and reads>=10 and idx==8:ok=0
   if fault=='post_changed' and reads>=10 and idx==3:v=0xae
   u.mem_write(u.reg_read(UC_ARM_REG_R2),bytes([v]));reads+=1;ret(ok)
  elif a<0x08010000:raise AssertionError(f'unreviewed native call {a:x}')
 def write(uc,access,a,s,v,ctx):
  nonlocal finished
  assert 0x20000000<=a<0x20024000 or a in [0xe000e010,0xe000e180,0xe000e280,0x40003000,0x40021034,0x40004800,0x50000400,0x50000028],f'unexpected direct peripheral/flash write {a:x}'
  if a==RESULT+252 and bytes(u.mem_read(RESULT,4))==b'SNS1':u.mem_write(a,struct.pack('<I',v));finished=True;u.emu_stop()
 u.hook_add(UC_HOOK_CODE,code);u.hook_add(UC_HOOK_MEM_WRITE,write)
 sp,entry=struct.unpack_from('<II',payload);u.reg_write(UC_ARM_REG_SP,sp);u.emu_start(entry,0,count=100000)
 assert finished;d=bytes(u.mem_read(RESULT,SIZE));w=struct.unpack_from('<12I',d)
 assert w[0]==0x31534e53 and w[1]==3 and w[4]==0 and fnv(d[:-4])==struct.unpack_from('<I',d,252)[0]
 if fault=='none':assert w[2]==0 and w[5]==w[6]==0x3ff and d[48:58]==d[58:68]
 elif fault in ['unknown','baseline_read']:assert w[2]==1 and not uart
 else:assert w[2]==2
 return {'fault':fault,'status':w[2],'yhmWrites':0,'templeBytes':0,'checksumVerified':True}
if __name__=='__main__':
 p=Path(sys.argv[1]);b=(p/'bridge.bin').read_bytes();root=Path(__file__).parent
 m={'payloadSha256':hashlib.sha256(b).hexdigest(),'payloadBytes':len(b),'sourceHashes':{n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ['bridge.c','start.S','link.ld','validate.py']},'cases':[run(b,f) for f in ['none','unknown','baseline_read','post_read','post_changed']],'hardwareProof':False}
 (p/'validated-manifest.json').write_text(json.dumps(m,indent=2)+'\n');print(json.dumps(m,indent=2))
