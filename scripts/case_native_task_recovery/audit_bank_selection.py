#!/usr/bin/env python3
"""Execute stock bank selection/page-erase instructions against register fixtures.

No serial access, no hardware erase, no ROM page-number mapping inference.
"""
import argparse,hashlib,json,struct,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from case_sbl_reset_prepared.trace import CASE_SHA256
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_MODE_MCLASS,UC_HOOK_CODE,UC_HOOK_MEM_WRITE
from unicorn.arm_const import UC_CPU_ARM_CORTEX_M0,UC_ARM_REG_SP,UC_ARM_REG_LR,UC_ARM_REG_PC,UC_ARM_REG_R0,UC_ARM_REG_R1

def run(code,optr,selector,page):
    u=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
    u.mem_map(0x08000000,0x10000);u.mem_write(0x08000000,code)
    u.mem_map(0x20000000,0x24000);u.mem_map(0x40022000,0x1000)
    def word(a,v):u.mem_write(a,struct.pack('<I',v))
    word(0x40022020,optr);word(0x20002be4,selector)
    u.reg_write(UC_ARM_REG_SP,0x20002c00);u.reg_write(UC_ARM_REG_LR,0x20010001)
    writes=[]
    def visit(uc,a,size,unused):
        assert (0x08002f46<=a<0x08002f60 or 0x08004a00<=a<0x08004a62 or
                0x08003ea8<=a<0x08003eba or 0x08003ec0<=a<0x08003eca or
                0x08003eec<=a<0x08003f10),hex(a)
    def write(uc,access,a,size,v,unused):
        if 0x20002b00<=a<0x20002c00:return
        assert a==0x40022014 and size==4,hex(a)
        writes.append(v)
    u.hook_add(UC_HOOK_CODE,visit);u.hook_add(UC_HOOK_MEM_WRITE,write)
    u.emu_start(0x08002f47,0x20010000,count=10000)
    assert u.reg_read(UC_ARM_REG_PC)==0x20010000 and not writes
    selected=u.reg_read(UC_ARM_REG_R0);assert selected==(1 if optr&(1<<20) else 2)
    bank=4 if selected==1 else 0x8000
    word(0x40022014,0)
    u.reg_write(UC_ARM_REG_R0,bank);u.reg_write(UC_ARM_REG_R1,page);u.reg_write(UC_ARM_REG_LR,0x20010001)
    u.emu_start(0x08003eed,0x20010000,count=10000)
    expected=0x10002|(page<<3)|(0x2000 if selected==2 else 0)
    assert writes==[expected]
    return {'optrFixture':hex(optr),'selectorFixture':selector,'physicalBankSelectedByStock':selected,
      'bankLocalPage':page,'eraseControlFixture':hex(expected),'passed':True}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--case-reference',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if a.output.exists():p.error('output must be fresh')
    code=a.case_reference.read_bytes()[32:]
    if hashlib.sha256(code).hexdigest()!=CASE_SHA256:raise ValueError('wrong native image')
    rows=[run(code,v,s,n) for v in (0xdeefe1aa,0xdeffe1aa) for s in (0,1,8) for n in (19,27,127)]
    report={'operation':'offline-stock-bank-controller-audit','sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
      'stockCodeSha256':CASE_SHA256,'cases':rows,'passed':True,'hardwareFlashWrites':0,
      'boundary':'Actual stock selector/option reader/erase leaf executed against fixtures. No physical erase, effective bank-mapping measurement or ROM erase-command mapping is proved.',
      'currentReadOnlyOptr':'0xdeefe1aa','currentStockBankSelection':2,'candidateBankLocalPages':[19,27]}
    a.output.write_text(json.dumps(report,indent=2)+'\n');print(f'Passed {len(rows)} offline stock bank/controller cases; hardware writes: 0.')
if __name__=='__main__':main()
