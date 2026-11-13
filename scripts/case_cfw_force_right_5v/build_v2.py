#!/usr/bin/env python3
"""Build Case 1.2.57 CFW force-right-5V v2. No serial I/O.

v2 keeps YHM reg4 (right 5V) continuously requested as 0xAF by:
  1. 0x08009A5C: policy always takes AF path (v1)
  2. 0x0800CF4E/D0DE/D15E/D192: every direct AE->reg4 becomes AF
  3. 0x0800BEF0/BF22: right sense-mode A6/FF -> AF
  4. 0x0800D092: water-detect stores 0 into right inhibit/secondary
  5. 0x0800BC22: 210s no-reply stores 0 into right inhibit/secondary
  6. 0x08007A88: NOP the 180s right GLS reset BL
Left-side writers and all other registers unchanged.
"""
import hashlib,json,struct,itertools,sys
from pathlib import Path
from unicorn import *
from unicorn.arm_const import *
SRC=Path('/Users/kalani/Repo/evenRealities-openCFW/g2/blobs/official/g2-2.2.6.10/firmware_box.bin')
STOCK='773b6d4cfdaf0a5a74a557e3babe8222a0ae813436b76a7437c1096d2c60d677'
OUT=Path(sys.argv[1]);OUT.mkdir(parents=True,exist_ok=True)
PATCHES=[
 # addr, old, new, note
 (0x08009A5C, '607c', '12e0', 'policy: b.n AF path'),
 (0x0800CF4E, 'ae21', 'af21', 'sensing off AE->AF'),
 (0x0800D0DE, 'ae21', 'af21', 'sense pulse end AE->AF'),
 (0x0800D15E, 'ae21', 'af21', 'startup AE->AF'),
 (0x0800D192, 'ae21', 'af21', 'startup AE->AF'),
 (0x0800BEF0, 'a621', 'af21', 'right sense A6->AF'),
 (0x0800BF22, 'ff21', 'af21', 'right sense FF->AF'),
 (0x0800D092, '0120', '0020', 'water: movs r0,#0 (clear inhibit)'),
 (0x0800BC22, '0120', '0020', 'noreply210: movs r0,#0'),
 (0x08007A88, '02f008f8', '00bf00bf', 'NOP 180s right GLS reset'),
]
def addsum(b):
 b=b+b'\0'*((-len(b))%4);return sum(struct.unpack('>%dI'%(len(b)//4),b))&0xffffffff
wrap=SRC.read_bytes();raw=bytearray(wrap[32:])
assert hashlib.sha256(raw).hexdigest()==STOCK
applied=[]
for addr,old,new,note in PATCHES:
 off=addr-0x08000000;ob=bytes.fromhex(old);nb=bytes.fromhex(new)
 assert raw[off:off+len(ob)]==ob,(hex(addr),raw[off:off+len(ob)].hex(),old)
 raw[off:off+len(nb)]=nb
 applied.append(dict(address=hex(addr),old=old,new=new,note=note))
raw=bytes(raw);hdr=bytearray(wrap[:32]);struct.pack_into('>I',hdr,12,addsum(raw));pw=bytes(hdr)+raw
(OUT/'firmware_box_1.2.57_force_right_5v_v2.bin').write_bytes(pw)
(OUT/'case_raw_force_right_5v_v2.bin').write_bytes(raw)
# --- emulator: policy 64 cases still force AF, left identical ---
ST=0x2000087c;PAIR=0x20000105
def policy(img,f):
 u=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
 u.mem_map(0x08000000,0x10000);u.mem_map(0x20000000,0x24000);u.mem_write(0x08000000,img)
 for o,v in zip((0x10,0x11,0x15,0x31,0x4d),f[:5]):u.mem_write(ST+o,bytes([v]))
 u.mem_write(PAIR,bytes([f[5]]));w={}
 def code(uc,a,n,d):
  if a==0x080099e8:
   w[uc.reg_read(UC_ARM_REG_R0)]=uc.reg_read(UC_ARM_REG_R1)&0xff;uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
  elif a==0x0badbeee:uc.emu_stop()
 u.hook_add(UC_HOOK_CODE,code);u.reg_write(UC_ARM_REG_SP,0x20020000);u.reg_write(UC_ARM_REG_LR,0x0badbeef)
 u.mem_map(0x0bad0000,0x10000);u.emu_start(0x08009a15,0x0badbeee,count=10000);return w
stock_raw=wrap[32:];cases=[];ok=True
for f in itertools.product((0,1),repeat=6):
 s=policy(stock_raw,f);q=policy(raw,f)
 assert q[4]==0xaf and q[3]==s[3]
 cases.append(1)
# --- emulator: sensing epilogue at D0D0 (AF then was-AE) ends with AF via 9a14 ---
def run_sense_tail(img):
 u=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
 u.mem_map(0x08000000,0x10000);u.mem_map(0x20000000,0x24000);u.mem_map(0x40000000,0x30000);u.mem_map(0xe000e000,0x2000)
 u.mem_write(0x08000000,img)
 # both present, inhibit set, secondary clear -> enters AF/AE pulse then 9a14
 u.mem_write(ST+0x10,b'\x01');u.mem_write(ST+0x11,b'\x01');u.mem_write(ST+0x15,b'\x01')
 u.mem_write(ST+0x4d,b'\x01');u.mem_write(ST+0x4f,b'\x00');u.mem_write(PAIR,b'\x00')
 # r4=state, r6=state+0x40 for the epilogue; set regs as the real frame would
 writes=[]
 def code(uc,a,n,d):
  if a==0x080099e8:
   writes.append((uc.reg_read(UC_ARM_REG_R0),uc.reg_read(UC_ARM_REG_R1)&0xff))
   uc.reg_write(UC_ARM_REG_R0,1);uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
  elif a in (0x0800a7b0,): # delay
   uc.reg_write(UC_ARM_REG_PC,uc.reg_read(UC_ARM_REG_LR))
  elif a==0x0badbeee:uc.emu_stop()
 u.hook_add(UC_HOOK_CODE,code)
 u.reg_write(UC_ARM_REG_R4,ST);u.reg_write(UC_ARM_REG_R6,ST+0x40)
 u.reg_write(UC_ARM_REG_SP,0x20020000);u.mem_write(0x20020000,struct.pack('<I',0)) # pop junk
 # start at D0B8 (inside the pulse block) through return; stub LR
 u.reg_write(UC_ARM_REG_LR,0x0badbeef);u.mem_map(0x0bad0000,0x10000)
 try:u.emu_start(0x0800d0b9,0x0badbeee,count=50000)
 except UcError as e:pass
 return writes
sense_writes=run_sense_tail(raw)
# final reg4 value among writes
r4s=[v for i,v in sense_writes if i==4]
assert r4s and r4s[-1]==0xaf and all(v==0xaf for v in r4s),r4s
# --- water/noreply store 0 ---
assert raw[0x0800D092-0x08000000]==0x00 and raw[0x0800BC22-0x08000000]==0x00
assert raw[0x08007A88-0x08000000:0x08007A88-0x08000000+4]==bytes.fromhex('00bf00bf')
m=dict(version='v2',stockRawSha256=STOCK,patchedWrapperSha256=hashlib.sha256(pw).hexdigest(),
 patchedRawSha256=hashlib.sha256(raw).hexdigest(),patchedChecksum=hex(addsum(raw)),
 patches=applied,bytesChanged=sum(len(bytes.fromhex(p[2])) for p in PATCHES),
 emulatorPolicyCases=len(cases),senseTailReg4Writes=[hex(v) for v in r4s],
 leftUntouched=True,hardwareProof=False)
(OUT/'manifest-v2.json').write_text(json.dumps(m,indent=2)+'\n');print(json.dumps(m,indent=2))
