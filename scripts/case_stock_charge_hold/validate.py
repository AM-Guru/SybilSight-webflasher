import hashlib,json,struct,sys
from pathlib import Path
from unicorn import *
from unicorn.arm_const import *
BASE=0x20010000;RESULT=0x20011a00

def fnv(d):
 h=2166136261
 for v in d:h=((h^v)*16777619)&0xffffffff
 return h

def run(payload,fault):
 u=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
 for a,n in [(0x08000000,0x10000),(0x20000000,0x24000),(0x40000000,0x30000),(0xe000e000,0x2000)]:u.mem_map(a,n)
 u.mem_write(BASE,payload);initial=bytes.fromhex('811104afaf03812033ff');reads=[0];done=[False];ticks=[0]
 def word(a,v):u.mem_write(a,struct.pack('<I',v))
 def ret(v=0):u.reg_write(UC_ARM_REG_R0,v);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
 def code(uc,a,n,data):
  if a in (0x08004eec,0x08008438,0x08006a40,0x08002888):
   word(0x40021008,0 if fault=='clock' else 0x12);word(0x4002100c,0x32020802);ret()
  elif a==0x08009040:
   i=u.reg_read(UC_ARM_REG_R0);assert i<10;v=initial[i];ok=1
   if fault=='unknown' and reads[0]<10 and i==4:v=0xae
   if fault=='baseline_read' and reads[0]<10 and i==8:ok=0
   if fault=='changed' and reads[0]>=10 and i==4:v=0xae
   u.mem_write(u.reg_read(UC_ARM_REG_R2),bytes([v]));reads[0]+=1;ret(ok)
  elif 0x08000000<=a<0x08010000:raise AssertionError(f'unexpected native call {a:x}')
 def read(uc,access,a,n,value,data):
  if a==0xe000e010:word(a,5 if fault=='timer' else 0x10005);ticks[0]+=1
 def write(uc,access,a,n,value,data):
  assert 0x20000000<=a<0x20024000 or a in (0xe000e010,0xe000e014,0xe000e018,0xe000e180,0xe000e280,0x40003000,0x40021034),hex(a)
  if a==RESULT+252 and bytes(u.mem_read(RESULT,4))==b'SNS1':
   u.mem_write(a,struct.pack('<I',value));done[0]=True;u.emu_stop()
 u.hook_add(UC_HOOK_CODE,code);u.hook_add(UC_HOOK_MEM_READ,read);u.hook_add(UC_HOOK_MEM_WRITE,write)
 sp,pc=struct.unpack_from('<II',payload);u.reg_write(UC_ARM_REG_SP,sp);u.emu_start(pc,0,count=30000000)
 assert done[0];d=bytes(u.mem_read(RESULT,256));w=struct.unpack_from('<12I',d);assert fnv(d[:-4])==struct.unpack_from('<I',d,252)[0];assert w[4]==w[10]==w[11]==0
 expected={'normal':0,'unknown':1,'baseline_read':1,'clock':3,'timer':7,'changed':8}[fault];assert w[2]==expected,(fault,w)
 if fault=='normal':assert w[3]==120 and ticks[0]==120000 and d[48:58]==d[58:68]
 if fault=='changed':assert w[3]==1
 return dict(fault=fault,status=w[2],secondsCompleted=w[3],yhmWrites=0,templeTxBytes=0,resetPulses=0,checksumVerified=True)
if __name__=='__main__':
 out=Path(sys.argv[1]);b=(out/'bridge.bin').read_bytes();root=Path(__file__).parent
 m=dict(payloadSha256=hashlib.sha256(b).hexdigest(),payloadBytes=len(b),sourceHashes={n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ('bridge.c','stock_waveform.inc','start.S','link.ld','validate.py')},cases=[run(b,f) for f in ('normal','unknown','baseline_read','clock','timer','changed')],hardwareProof=False,mechanism='Hold existing stock AF/AF only; no YHM writes, no GPIO reset, no UART; abort on any10register change.')
 (out/'validated-manifest.json').write_text(json.dumps(m,indent=2)+'\n');print(json.dumps(m,indent=2))
