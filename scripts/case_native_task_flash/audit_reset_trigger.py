#!/usr/bin/env python3
"""Trace actual B0 producer/consumer and no-reply timer code offline."""
import argparse,json,struct,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from case_native_task_flash.build import sha
from case_sbl_reset_prepared.trace import CASE_SHA256
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_MODE_MCLASS,UC_HOOK_CODE
from unicorn.arm_const import UC_CPU_ARM_CORTEX_M0,UC_ARM_REG_SP,UC_ARM_REG_LR,UC_ARM_REG_PC,UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R4,UC_ARM_REG_R5

def machine(code):
    u=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
    u.mem_map(0x08000000,0x10000);u.mem_write(0x08000000,code);u.mem_map(0x20000000,0x24000)
    u.mem_write(0x200000bf,b'\x01');u.mem_write(0x200000f0,struct.pack('<I',0x20002000));u.reg_write(UC_ARM_REG_SP,0x20002c00)
    return u

def ret(u):u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))

def producer(code):
    u=machine(code);calls=[];u.mem_write(0x20011000,b'\xb0')
    def visit(uc,a,size,unused):
        if a==0x0800a888:
            calls.append([u.reg_read(UC_ARM_REG_R0),u.reg_read(UC_ARM_REG_R1)]);u.reg_write(UC_ARM_REG_R0,0);ret(u)
        else:assert 0x08000928<=a<0x08000d30,hex(a)
    u.hook_add(UC_HOOK_CODE,visit);u.reg_write(UC_ARM_REG_R0,0x20011000);u.reg_write(UC_ARM_REG_R1,1);u.reg_write(UC_ARM_REG_LR,0x20012001)
    u.emu_start(0x08000929,0x20012000,count=10000)
    assert calls==[[0x20002000,0x100]] and u.reg_read(UC_ARM_REG_PC)==0x20012000
    return {'commandByte':'0xb0','nativeHandler':'0x08000928','eventWrapper':'0x0800a888','eventHandleFixture':'0x20002000','eventMask':256,'passed':True}

def consumer(code,mask):
    u=machine(code);calls=[];clears=[];u.reg_write(UC_ARM_REG_R4,0x200000b8);u.reg_write(UC_ARM_REG_R5,mask)
    def visit(uc,a,size,unused):
        if a==0x08009a9c:calls.append([u.reg_read(UC_ARM_REG_R0),u.reg_read(UC_ARM_REG_R1)]);ret(u)
        elif a==0x0800a7d2:clears.append([u.reg_read(UC_ARM_REG_R0),u.reg_read(UC_ARM_REG_R1)]);ret(u)
        else:assert 0x08006fcc<=a<0x08006ff4,hex(a)
    u.hook_add(UC_HOOK_CODE,visit);u.emu_start(0x08006fcd,0x08006ff4,count=1000)
    assert calls==([[1,1]] if mask==0x100 else [])
    assert clears==([[0x20002000,0x100]] if mask==0x100 else [])
    return {'eventMaskFixture':mask,'nativeBothSidesResetCalls':calls,'eventClearCalls':clears,'passed':True}

def timer(code,seconds):
    u=machine(code);calls=[];divisors=[];base=0x20000800;u.reg_write(UC_ARM_REG_R4,base)
    for off,value in ((0x40,8),(0x44,seconds),(0x5c,8),(0x60,seconds)):u.mem_write(base+off,struct.pack('<I',value))
    def visit(uc,a,size,unused):
        if a==0x08000160:
            numerator,divisor=u.reg_read(UC_ARM_REG_R0),u.reg_read(UC_ARM_REG_R1);divisors.append(divisor)
            u.reg_write(UC_ARM_REG_R0,numerator//divisor);u.reg_write(UC_ARM_REG_R1,numerator%divisor);ret(u)
        elif a==0x08009a9c:calls.append([u.reg_read(UC_ARM_REG_R0),u.reg_read(UC_ARM_REG_R1)]);ret(u)
        elif a in (0x08009170,0x0800bb74):ret(u)
        else:assert 0x080079b4<=a<0x08007abc,hex(a)
    u.hook_add(UC_HOOK_CODE,visit);u.emu_start(0x080079b5,0x08007abc,count=10000)
    assert divisors==[15,15,180,180]
    expected=[[1,0],[0,1]] if (seconds+1)%180==0 else []
    assert calls==expected
    return {'secondsBeforeFixture':seconds,'secondsAfter':seconds+1,'nativeDivisors':divisors,'nativeResetCalls':calls,'passed':True}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--case-reference',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if a.output.exists():p.error('output must be fresh')
    code=a.case_reference.read_bytes()[32:]
    if sha(code)!=CASE_SHA256:raise ValueError('wrong stock code')
    rows=[producer(code),consumer(code,0),consumer(code,0x100)]+[timer(code,n) for n in (14,44,178,179,180)]
    r={'operation':'native-explicit-reset-and-timer-audit','sourceSha256':sha(Path(__file__).read_bytes()),'stockCodeSha256':sha(code),'cases':rows,'passed':True,
      'asciiParserExecuted':False,'rtosEventDeliveryExecuted':False,'nativePulseExecuted':False,'hardwareCommandsSent':0,
      'boundary':'Actual handler/consumer/timer branch instructions executed. Event delivery, division and reset callees are fixtures. DEB0 text framing comes from the existing traced stock-console helper.'}
    a.output.write_text(json.dumps(r,indent=2)+'\n');print(f'Passed {len(rows)} native trigger/timer cases: B0 -> event0x100 -> reset(1,1); reset period180, log period15.')
if __name__=='__main__':main()
