#!/usr/bin/env python3
"""Model compiled early probe, exact reset actions, fixed HELLO and failures.
No physical waveform, chip provisioning or temple recovery claim.
"""
import hashlib,json,struct,sys
from pathlib import Path
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_MODE_MCLASS,UC_HOOK_CODE,UC_HOOK_MEM_WRITE,UC_HOOK_MEM_READ
from unicorn.arm_const import UC_CPU_ARM_CORTEX_M0,UC_ARM_REG_SP,UC_ARM_REG_PC,UC_ARM_REG_LR,UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2
BASE=0x20010000;RESULT=0x20011a00;SIZE=256;UART=0x40004800
HELLO=bytes.fromhex('14559de900000800')
def fnv(data):
 h=2166136261
 for b in data:h=((h^b)*16777619)&0xffffffff
 return h

def run(payload,fault,expected,control=False,bursts=1):
 request=b''
 u=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
 for a,s in [(0x08000000,0x10000),(0x20000000,0x24000),(0x40000000,0x30000),(0x50000000,0x2000),(0xe000e000,0x2000)]:u.mem_map(a,s)
 u.mem_write(BASE,payload);reads=0;finished=False;configured=False;regs=bytearray.fromhex('811104afaf03812033ff');original=bytes(regs);trace=[];tx=[];writes=[];faulted=False;rx=list(bytes.fromhex('5aa5ff00')) if fault=='noise' else []
 def ret(v=0):u.reg_write(UC_ARM_REG_R0,v);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
 def word(a,v):u.mem_write(a,struct.pack('<I',v))
 def code(uc,a,s,ctx):
  nonlocal reads,configured,faulted
  if a in [0x08004eec,0x08008438,0x08006a40,0x08002888,0x08002cb8]:ret()
  elif a==0x08006cf8:
   for addr,val in [(0x40021008,0x12),(0x4002100c,0x32020802),(UART,9),(UART+4,0),(UART+8,0x1000),(UART+0xc,64)]:word(addr,val)
   if fault=='clock':word(0x40021008,0)
   if fault=='framing':word(UART+4,0x400)
   ret()
  elif a==0x08006c80:word(UART,5);ret()
  elif a==0x08004d30:
   assert u.reg_read(UC_ARM_REG_R0)==0x50000400
   cfg=struct.unpack('<5I',u.mem_read(u.reg_read(UC_ARM_REG_R1),20));assert cfg==(0x200,1,0,3,0);configured=True;word(0x50000400,0x60000);ret()
  elif a==0x08004e9e:
   stage=struct.unpack('<I',u.mem_read(RESULT+36,4))[0]
   if stage!=2 or struct.unpack('<I',u.mem_read(RESULT+44,4))[0]:assert u.reg_read(UC_ARM_REG_R0)==0x50000000 and u.reg_read(UC_ARM_REG_R1)==8;ret();return
   assert configured
   trace.append({'operation':'gpio','base':hex(u.reg_read(UC_ARM_REG_R0)),'mask':hex(u.reg_read(UC_ARM_REG_R1)),'high':u.reg_read(UC_ARM_REG_R2)!=0});ret()
  elif a==0x0800a7a2:
   if fault in ('intrain','overflow') and not faulted:
    rx.extend(bytes.fromhex('0102030405060708'));faulted=True
   trace.append({'operation':'nativeBusyDelay','iterations':u.reg_read(UC_ARM_REG_R0)});ret()
  elif a==0x08009040:
   idx=u.reg_read(UC_ARM_REG_R0);assert idx<10
   v=regs[idx];ok=1
   if fault=='unknown' and reads<10 and idx==6:v=0x8d
   if fault=='baseline_read' and reads<10 and idx==8:ok=0
   if fault=='post_read' and reads>=10 and idx==8:ok=0
   if fault=='post_changed' and reads>=10 and idx==4:v=0xa6
   u.mem_write(u.reg_read(UC_ARM_REG_R2),bytes([v]));reads+=1;ret(ok)
  elif a==0x08009108:
   idx=u.reg_read(UC_ARM_REG_R0);v=u.mem_read(u.reg_read(UC_ARM_REG_R2),1)[0]
   assert idx in [3,4,5,6,7] and u.reg_read(UC_ARM_REG_R1)==1
   assert v==original[idx] or (idx,v) in [(5,3),(6,0xc1),(3,0xa6),(4,0xa6),(7,3),(7,5)]
   writes.append((idx,v))
   if fault=='write' and not faulted:faulted=True;ret(0)
   elif fault=='restore_write' and idx==6 and v==0x81:ret(0)
   else:regs[idx]=v;ret(1)
  elif a<0x08010000:raise AssertionError(f'unreviewed native call {a:x}')
 tickreads=0
 def read(uc,access,a,s,v,ctx):
  nonlocal tickreads
  if a==UART+0xc and fault=='baud_readback' and struct.unpack('<I',u.mem_read(a,4))[0]==556:word(a,555)
  elif a==0xe000e010:
   tickreads+=1;word(a,5 if fault=='timer' else 0x10005)
  elif a==UART+0x1c:word(a,(0 if fault=='no_reack' else 0x400000)|(0 if fault=='tx_timeout' else 0xc0)|(0x20 if len(tx)==len(request) and rx else 0)|(1 if fault=='uart_error' else 8 if fault=='overflow' and faulted else 0))
  elif a==UART+0x24:
   assert struct.unpack('<I',u.mem_read(RESULT+44,4))[0]==1, 'in-train CPU receive read'
   word(a,rx.pop(0) if rx else 0)
 def write(uc,access,a,s,v,ctx):
  nonlocal finished,tickreads
  assert 0x20000000<=a<0x20024000 or a in [0xe000e010,0xe000e014,0xe000e018,0xe000e180,0xe000e280,0x40003000,0x40021034,UART,UART+8,UART+0xc,UART+0x18,UART+0x20,UART+0x28,0x50000400,0x50000028],f'unexpected peripheral/flash write {a:x}'
  if a==UART+0x28:
   assert len(tx)<len(request)*bursts and v==request[len(tx)%len(request)] and regs[6]==0xc1 and regs[7]==(3 if control==1 else 5);tx.append(v)
  if a==0xe000e010 and v==0 and trace:
   # A completed delay inside reset has exactly the stock number of ticks.
   stage=struct.unpack('<I',u.mem_read(RESULT+36,4))[0]
   if stage==2 and tickreads:trace.append({'operation':'osDelay','ticks':tickreads})
   tickreads=0
  elif a==0xe000e010 and v==5:tickreads=0
  if a==RESULT+252 and bytes(u.mem_read(RESULT,4))==b'SNS1':u.mem_write(a,struct.pack('<I',v));finished=True;u.emu_stop()
 u.hook_add(UC_HOOK_CODE,code);u.hook_add(UC_HOOK_MEM_WRITE,write);u.hook_add(UC_HOOK_MEM_READ,read)
 sp,entry=struct.unpack_from('<II',payload);u.reg_write(UC_ARM_REG_SP,sp);u.emu_start(entry,0,count=10000000)
 assert finished;d=bytes(u.mem_read(RESULT,SIZE));w=struct.unpack_from('<12I',d)
 assert w[0]==0x31534e53 and w[1]==4 and fnv(d[:-4])==struct.unpack_from('<I',d,252)[0]
 if fault in ['none','noise','uart_error','tx_timeout','intrain','overflow']:
  assert w[2]==0 and w[5]==w[6]==0x3ff and d[48:58]==d[58:68] and bytes(regs)==original and bytes(tx)==request*bursts and w[11]==(0 if control else 1)
  assert trace==([] if control else expected),(trace,expected)
 elif fault in ['unknown','baseline_read']:assert w[2]==1 and not writes and not tx
 elif fault in ['clock','framing']:assert w[2]==3 and not writes and not tx
 elif fault in ['post_read','post_changed','restore_write']:assert w[2]==8
 elif fault in ('no_reack','baud_readback'):assert w[2]==9 and not tx and not w[11] and bytes(regs)==original
 elif fault=='write':assert w[2]==4 and not tx and bytes(regs)==original
 elif fault=='timer':assert w[2]==4 and not tx and bytes(regs)==original

 if fault in ('intrain','overflow'):assert d[72:80]==bytes.fromhex('0102030405060708') and w[3]==8
 if fault=='overflow':assert w[7]&8
 return {'fault':fault,'status':w[2],'yhmWrites':len(writes),'templeBytes':len(tx),'resetCompleted':bool(w[11]),'checksumVerified':True}
if __name__=='__main__':
 bursts=4 if sys.argv[2]=='early-windowed' else 1;control=1 if sys.argv[2]=='left-control' else 2 if sys.argv[2]=='right-control' else 0;p=Path(sys.argv[1]);b=(p/'bridge.bin').read_bytes();root=Path(__file__).parent
 expected=json.loads(Path('work/recovery-window-2026-10-14/stock-reset-waveform.json').read_text())['trace']
 m={'payloadSha256':hashlib.sha256(b).hexdigest(),'payloadBytes':len(b),'sourceHashes':{n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ['bridge.c','stock_waveform.inc','start.S','link.ld','validate.py']},'cases':[run(b,f,expected,control,bursts) for f in ['none','unknown','baseline_read','clock','framing','write','timer','tx_timeout','post_read','post_changed','restore_write','noise','uart_error','intrain','overflow','no_reack','baud_readback']],'hardwareProof':False,'maxHelloFrames':0,'nominalHelloOffsetsMs':[],'resetSequenceComparison':'103 stock GPIO/delay actions exactly match compiled bridge model','variant':sys.argv[2],'transmitAllowlist':'','captureMethod':'UART hardware FIFO enabled before stock train; drain only afterward; no in-train CPU service'}
 (p/'validated-manifest.json').write_text(json.dumps(m,indent=2)+'\n');print(json.dumps(m,indent=2))
