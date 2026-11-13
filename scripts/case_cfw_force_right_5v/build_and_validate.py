#!/usr/bin/env python3
"""Build Case 1.2.57 CFW 'force-right-5V' and validate it in Unicorn. Opens no serial port.
Patch: 0x08009A5C  60 7C (ldrb r0,[r4,#17]) -> 12 E0 (b.n 0x08009A84)
In the YHM output policy 0x08009A14 this skips the right-side gates (present +0x11,
global enable +0x15, inhibit/water/no-reply +0x4D, paired policy [0x20000105]) so
register 4 is always requested 0xAF (right output on). Left path is unchanged."""
import hashlib,json,struct,itertools,sys
from pathlib import Path
from unicorn import *
from unicorn.arm_const import *
SRC=Path('/Users/kalani/Repo/evenRealities-openCFW/g2/blobs/official/g2-2.2.6.10/firmware_box.bin')
STOCK_RAW_SHA='773b6d4cfdaf0a5a74a557e3babe8222a0ae813436b76a7437c1096d2c60d677'
OUT=Path(sys.argv[1] if len(sys.argv)>1 else 'build');OUT.mkdir(parents=True,exist_ok=True)
PATCH_ADDR=0x08009A5C;OLD=bytes.fromhex('607c');NEW=bytes.fromhex('12e0')
def addsum(b):
 b=b+b'\0'*((-len(b))%4);return sum(struct.unpack('>%dI'%(len(b)//4),b))&0xffffffff
wrap=SRC.read_bytes();raw=wrap[32:]
assert hashlib.sha256(raw).hexdigest()==STOCK_RAW_SHA
assert struct.unpack_from('>I',wrap,8)[0]==len(raw) and struct.unpack_from('>I',wrap,12)[0]==addsum(raw)
off=PATCH_ADDR-0x08000000;assert raw[off:off+2]==OLD
p=bytearray(raw);p[off:off+2]=NEW;p=bytes(p)
hdr=bytearray(wrap[:32]);struct.pack_into('>I',hdr,12,addsum(p));pw=bytes(hdr)+p
assert sum(a!=b for a,b in zip(raw,p))==2
(OUT/'firmware_box_1.2.57_force_right_5v.bin').write_bytes(pw);(OUT/'case_raw_force_right_5v.bin').write_bytes(p)
ST=0x2000087c;PAIR=0x20000105
def policy(img,f):
 u=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
 u.mem_map(0x08000000,0x10000);u.mem_map(0x20000000,0x24000);u.mem_write(0x08000000,img)
 lp,rp,en,linh,rinh,pair=f
 for o,v in ((0x10,lp),(0x11,rp),(0x15,en),(0x31,linh),(0x4d,rinh)):u.mem_write(ST+o,bytes([v]))
 u.mem_write(PAIR,bytes([pair]));w={}
 def code(uc,a,n,d):
  if a==0x080099e8:
   w[u.reg_read(UC_ARM_REG_R0)]=u.reg_read(UC_ARM_REG_R1)&0xff;u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
  elif a==0x0badbeee:u.emu_stop()
 u.hook_add(UC_HOOK_CODE,code);u.reg_write(UC_ARM_REG_SP,0x20020000);u.reg_write(UC_ARM_REG_LR,0x0badbeef)
 u.mem_map(0x0bad0000,0x10000);u.emu_start(0x08009a15,0x0badbeee,count=10000);return w
cases=[];
for f in itertools.product((0,1),repeat=6):
 s=policy(raw,f);q=policy(p,f)
 assert s[5]==3 and s[6]==0x81 and s[7]==0x20 and q[5]==3 and q[6]==0x81 and q[7]==0x20
 assert q[3]==s[3],('left changed',f);assert q[4]==0xaf,('right not forced',f)
 cases.append(dict(leftPresent=f[0],rightPresent=f[1],globalEnable=f[2],leftInhibit=f[3],rightInhibit=f[4],pairedPolicy=f[5],stockR4=hex(s[4]),patchedR4=hex(q[4]),stockR3=hex(s[3]),patchedR3=hex(q[3])))
stock_af=sum(c['stockR4']=='0xaf' for c in cases)
m=dict(stockWrapperSha256=hashlib.sha256(wrap).hexdigest(),stockRawSha256=STOCK_RAW_SHA,patchedWrapperSha256=hashlib.sha256(pw).hexdigest(),patchedRawSha256=hashlib.sha256(p).hexdigest(),patchedChecksum=hex(addsum(p)),patch=dict(address=hex(PATCH_ADDR),old=OLD.hex(),new=NEW.hex(),meaning='b.n 0x08009A84: always write YHM reg4=0xAF'),bytesChanged=2,emulatorCases=len(cases),stockRightOnCases=stock_af,patchedRightOnCases=64,leftIdenticalAllCases=True,hardwareProof=False)
(OUT/'manifest.json').write_text(json.dumps(m,indent=2)+'\n');(OUT/'emulator-cases.json').write_text(json.dumps(cases,indent=1));print(json.dumps(m,indent=2))
