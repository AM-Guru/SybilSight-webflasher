#!/usr/bin/env python3
"""Read candidate flash pages and test SRAM retention; no flash writer."""
import argparse,hashlib,json,sys,time
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from g2_case_rom import open_rom_loader,require_expected_identity,write_sram,restore_application
from case_sbl_discovery.run import preflight,read_range
from case_native_task_recovery.rom_epochs import bound_rom,read_fresh
from case_sbl_reset_prepared.trace import CASE_SHA256
BASE=0x20010000
SIZE=0x2000
PAGES=(0x08009800,0x0800d800)

def sha(data):return hashlib.sha256(data).hexdigest()

def put(port,address,data):
    if not data or len(data)>256 or len(data)%4 or address%4 or not BASE<=address<address+len(data)<=BASE+SIZE:
        raise ValueError('outside fixed retention-check SRAM window')
    write_sram(port,address,data)
    if read_range(port,address,len(data))!=data:raise ValueError('SRAM block mismatch')

def put_fresh(device,case_serial,data):
    if len(data)!=SIZE:raise ValueError('fixed SRAM snapshot length required')
    for base in range(0,SIZE,4096):
        with bound_rom(device,case_serial) as port:
            for offset in range(base,base+4096,256):put(port,BASE+offset,data[offset:offset+256])


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--device',required=True);p.add_argument('--case-serial',required=True)
    p.add_argument('--case-reference',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--execute-sram-retention-check',action='store_true',required=True)
    a=p.parse_args()
    if a.output.exists():p.error('output directory must be fresh')
    code=a.case_reference.read_bytes()[32:]
    if sha(code)!=CASE_SHA256:raise ValueError('wrong reviewed stock reference')
    a.output.mkdir(parents=True)
    report={'updatedAt':datetime.now(timezone.utc).isoformat(),'operation':'read-flash-pages-and-fixed-sram-retention-check',
       'caseSerial':a.case_serial,'flashWrites':0,'firmwareImageBytesSent':0,'sramBase':hex(BASE),'sramBytes':SIZE,
       'normalApplicationHoldSeconds':5,'transport':'fresh-UID-bound-ROM-epochs-max4096-read-bytes','outcome':'not-started','stockRestored':False}
    original=None;dirty=False;touched=False
    try:
        report['preflight']=preflight(a.device,a.case_serial,'left')
        touched=True
        report['caseCodeReadbacks']=[]
        for attempt in (1,2):
            live=read_fresh(a.device,a.case_serial,0x08000000,len(code),progress=lambda n,total: print(f'Fresh-ROM readback {attempt}: {n}/{total}',flush=True) if n%8192==0 or n==total else None)
            report['caseCodeReadbacks'].append({'attempt':attempt,'sha256':sha(live),'matchesPinnedReference':live==code})
            if live!=code:raise ValueError('complete case code mismatch')
        with bound_rom(a.device,a.case_serial) as port:
            size_raw=read_range(port,0x1fff75e0,2)
            report['flashSizeRawHex']=size_raw.hex();report['flashSizeKiB']=int.from_bytes(size_raw,'little')&0x3ff
            if report['flashSizeKiB'] not in (128,256,512):raise ValueError('unexpected case flash size')
            report['pages']=[]
            for address in PAGES:
                first=read_range(port,address,2048);second=read_range(port,address,2048)
                if first!=second:raise ValueError('candidate flash page reads differ')
                offset=address-0x08000000;stock=code[offset:min(offset+2048,len(code))]
                if first[:len(stock)]!=stock:raise ValueError('candidate code page differs from stock')
                name=f'page-{address:08x}.bin';(a.output/name).write_bytes(first)
                row={'address':hex(address),'bytes':2048,'sha256':sha(first),'saved':name,'stockPrefixMatches':True}
                if offset+2048>len(code):
                    tail=first[len(stock):];row.update(tailAddress=hex(0x08000000+len(code)),tailBytes=len(tail),tailAllErased=tail==b'\xff'*len(tail))
                    if not row['tailAllErased']:raise ValueError('tail is not erased; do not place a hook there')
                report['pages'].append(row)
        original=read_fresh(a.device,a.case_serial,BASE,SIZE);(a.output/'sram-original.bin').write_bytes(original)
        seed=f"G2 native-task retention {report['updatedAt']}".encode()
        pattern=b''.join(hashlib.sha256(seed+i.to_bytes(4,'little')).digest() for i in range(SIZE//32))
        (a.output/'sram-canary.bin').write_bytes(pattern)
        dirty=True
        put_fresh(a.device,a.case_serial,pattern)
        report['canaryWrittenAndReadBack']=True
        report['applicationBootBeforeHold']=restore_application(a.device,expected_version='1.2.57')
        time.sleep(5)
        observed=read_fresh(a.device,a.case_serial,BASE,SIZE);(a.output/'sram-after-stock-boot.bin').write_bytes(observed)
        report['retainedAllBytes']=observed==pattern
        report['retainedMatches']=sum(x==y for x,y in zip(observed,pattern))
        report['canarySha256']=sha(pattern);report['observedSha256']=sha(observed)
        report['outcome']='retention-and-erased-tail-qualified' if observed==pattern else 'retention-failed'
    except Exception as error:
        report['error']=str(error);report['outcome']='failed-closed'
    finally:
        if dirty and original is not None:
            try:
                put_fresh(a.device,a.case_serial,original)
                report['originalSramRestoredAndVerified']=True
            except Exception as error:report['sramRestoreError']=str(error);report['outcome']='sram-restore-unverified'
        if touched:
            try:report['stockRestored']=restore_application(a.device,expected_version='1.2.57')=='1.2.57'
            except Exception as error:report['stockRestoreError']=str(error);report['outcome']='stock-restore-unverified'
        (a.output/'qualification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='preflight'},indent=2),flush=True)
    return 0 if report['outcome']=='retention-and-erased-tail-qualified' and report['stockRestored'] else 2
if __name__=='__main__':raise SystemExit(main())
