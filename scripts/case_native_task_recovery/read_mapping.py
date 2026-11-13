#!/usr/bin/env python3
"""Read effective FLASH registers through a validated SRAM-only reader."""
import argparse,hashlib,json,struct,subprocess,sys,time
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from g2_case_rom import write_sram,go_sram,restore_application
from case_sbl_discovery.run import preflight,read_range
from case_native_task_recovery.rom_epochs import bound_rom,read_fresh
from case_sbl_reset_prepared.trace import fnv
ROOT=Path(__file__).resolve().parent

def decode(data):
    w=struct.unpack('<8I',data)
    if w[:2]!=(0x504d3247,1) or w[6]!=w[2]^0xffffffff or w[7]!=fnv(data[:28]):raise ValueError('mapping evidence invalid')
    return {'optr':hex(w[2]),'acr':hex(w[3]),'cr':hex(w[4]),'sr':hex(w[5]),'nSwapBankBit':(w[2]>>20)&1,'dualBankBit':(w[2]>>21)&1,'rdpByte':hex(w[2]&255)}

def validate(payload):
    from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_MODE_MCLASS,UC_HOOK_MEM_WRITE
    from unicorn.arm_const import UC_CPU_ARM_CORTEX_M0,UC_ARM_REG_SP
    u=Uc(UC_ARCH_ARM,UC_MODE_THUMB|UC_MODE_MCLASS);u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
    u.mem_map(0x20010000,0x5000);u.mem_write(0x20010000,payload);u.mem_map(0x40000000,0x30000)
    expected=[0xdeefe1aa,0x100,0xc0000000,0]
    for addr,value in zip([0x40022020,0x40022000,0x40022014,0x40022010],expected):u.mem_write(addr,struct.pack('<I',value))
    stopped=[]
    def write(uc,access,address,size,value,unused):
        if 0x20011a00<=address<0x20011a20 or 0x20013000<=address<0x20014000:return
        assert address==0x40003000 and value==0xaaaa,'reader wrote a peripheral other than watchdog'
        stopped.append(True);u.emu_stop()
    u.hook_add(UC_HOOK_MEM_WRITE,write);stack,entry=struct.unpack_from('<II',payload)
    assert stack==0x20014000 and entry==0x20010009
    u.reg_write(UC_ARM_REG_SP,stack);u.emu_start(entry,0,count=100000)
    assert stopped and decode(bytes(u.mem_read(0x20011a00,32)))['optr']==hex(expected[0])

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--device',required=True);p.add_argument('--case-serial',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if a.output.exists():p.error('output must be fresh')
    a.output.mkdir(parents=True);sources={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in ['mapping.c','mapping_start.S','mapping.ld','read_mapping.py']}
    for stem in ['mapping','mapping_start']:
        suffix='c' if stem=='mapping' else 'S'
        subprocess.run(['/usr/bin/clang','--target=arm-none-eabi','-mcpu=cortex-m0plus','-mthumb','-Os','-ffreestanding','-fno-builtin','-Wall','-Wextra','-Werror','-c',str(ROOT/f'{stem}.{suffix}'),'-o',str(a.output/f'{stem}.o')],check=True)
    subprocess.run(['arm-none-eabi-ld','-T',str(ROOT/'mapping.ld'),str(a.output/'mapping_start.o'),str(a.output/'mapping.o'),'-o',str(a.output/'mapping.elf')],check=True)
    subprocess.run(['arm-none-eabi-objcopy','-O','binary',str(a.output/'mapping.elf'),str(a.output/'mapping.bin')],check=True)
    payload=(a.output/'mapping.bin').read_bytes();validate(payload)
    r={'operation':'effective-flash-register-SRAM-reader','capturedAt':datetime.now(timezone.utc).isoformat(),'caseSerial':a.case_serial,'sourceHashes':sources,'payloadSha256':hashlib.sha256(payload).hexdigest(),'compiledReadWriteAllowlistPassed':True,'flashWrites':0,'templeBytesSent':0,'outcome':'not-started'}
    original=None;old_result=None;dirty=False;touched=False
    def put(port,address,data):
        if address not in (0x20010000,0x20011a00) or len(data)%4 or len(data)>256:raise ValueError('reader SRAM bounds')
        write_sram(port,address,data)
        if read_range(port,address,len(data))!=data:raise ValueError('reader SRAM mismatch')
    try:
        r['preflight']=preflight(a.device,a.case_serial,'left');touched=True
        size=(len(payload)+3)&~3
        if size>256:raise ValueError('reader exceeds fixed single-block code window')
        original=read_fresh(a.device,a.case_serial,0x20010000,size);old_result=read_fresh(a.device,a.case_serial,0x20011a00,32)
        with bound_rom(a.device,a.case_serial) as port:
            dirty=True;put(port,0x20010000,payload+bytes(size-len(payload)));put(port,0x20011a00,bytes(32))
            if sources!={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in sources}:raise ValueError('reader source changed')
            try:go_sram(port);r['launchAcknowledged']=True
            except Exception as e:r['launchAcknowledged']=False;r['launchError']=str(e)
            port.dtr=True;time.sleep(0.25)
        raw=read_fresh(a.device,a.case_serial,0x20011a00,32);(a.output/'result.bin').write_bytes(raw);r['result']=decode(raw);r['outcome']='effective-registers-read'
    except Exception as e:r['error']=str(e);r['outcome']='failed-closed'
    finally:
        if dirty and original is not None and old_result is not None:
            try:
                with bound_rom(a.device,a.case_serial) as port:put(port,0x20010000,original);put(port,0x20011a00,old_result)
                r['originalSramRestored']=True
            except Exception as e:r['sramRestoreError']=str(e);r['outcome']='sram-restore-unverified'
        if touched:
            try:r['stockVersionRestored']=restore_application(a.device,expected_version='1.2.57')
            except Exception as e:r['stockRestoreError']=str(e);r['outcome']='stock-restore-unverified'
        (a.output/'audit.json').write_text(json.dumps(r,indent=2)+'\n')
    print(json.dumps({k:v for k,v in r.items() if k!='preflight'},indent=2));return 0 if r['outcome']=='effective-registers-read' else 2
if __name__=='__main__':raise SystemExit(main())
