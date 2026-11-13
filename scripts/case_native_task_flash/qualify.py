#!/usr/bin/env python3
"""Execute mode2 only: no FLASH register writes, erase, program or temple command."""
import argparse,json,os,sys,time
from datetime import datetime,timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from case_native_task_flash.build import CASE_SERIAL,load_pages,source_paths,sha
from case_native_task_flash.protocol import request,decode
from case_native_task_flash.validate import CASES
from case_native_task_flash.artifacts import inspect
from case_native_task_recovery.rom_epochs import bound_rom,read_fresh
from case_sbl_discovery.run import preflight
from case_sbl_reset_prepared.trace import CASE_SHA256
from g2_case_rom import write_sram,read_memory,go_sram,restore_application,BootloaderError
ROOT=Path(__file__).resolve().parent
BASE,SIZE=0x20010000,0x8000

def put_all(device,data):
    if len(data)!=SIZE:raise ValueError('fixed writer snapshot size required')
    for base in range(0,SIZE,1024):
        for attempt in range(2):
            try:
                with bound_rom(device,CASE_SERIAL) as port:
                    for offset in range(base,base+1024,256):
                        block=data[offset:offset+256];write_sram(port,BASE+offset,block)
                        got=b''.join(read_memory(port,BASE+offset+i,min(31,256-i),attempts=1) for i in range(0,256,31))
                        if got!=block:raise ValueError('writer SRAM snapshot mismatch')
                break
            except (BootloaderError,OSError):
                # SRAM writes only: repeat the exact epoch on a new UID-bound
                # transport. Never retry GO or a flash operation here.
                if attempt==1:raise

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--device',required=True)
    for n in ('build','plan','context-build','case-reference','output'):p.add_argument('--'+n,type=Path,required=True)
    a=p.parse_args()
    if a.output.exists():p.error('output must be fresh')
    m,payload,pages=inspect(a.build,a.plan,a.context_build,a.case_reference)
    frozen={str(p.resolve()):sha(p.read_bytes()) for p in [Path(__file__),ROOT/'artifacts.py',*source_paths(),Path(__file__).parents[1]/'case_native_task_recovery/rom_epochs.py',Path(__file__).parents[1]/'g2_case_rom.py']}
    stock=a.case_reference.read_bytes()[32:]
    if sha(stock)!=CASE_SHA256:raise ValueError('wrong stock reference')
    a.output.mkdir(parents=True)
    (a.output/'source-snapshot').mkdir()
    for i,name in enumerate(frozen):(a.output/'source-snapshot'/f'{i:02}-{Path(name).name}').write_bytes(Path(name).read_bytes())
    report={'operation':'read-only-qualification-of-exact-page-writer','startedAt':datetime.now(timezone.utc).isoformat(),
      'caseSerial':CASE_SERIAL,'payloadSha256':sha(payload),'sourceHashes':frozen,'mode':2,'rows':[],
      'flashWrites':0,'templeCommandBytes':0,'outcome':'not-started'}
    original=None;dirty=False;touched=False
    try:
        report['preflight']=preflight(a.device,CASE_SERIAL,'left');touched=True
        live=read_fresh(a.device,CASE_SERIAL,0x08000000,len(stock),progress=lambda n,t:print(f'Preflight code {n}/{t}',flush=True) if n%8192==0 or n==t else None)
        if live!=stock:raise ValueError('live complete stock code mismatch')
        report['fullStockCodeVerifiedBefore']=True
        for i,address in enumerate((0x08009800,0x0800d800)):
            if read_fresh(a.device,CASE_SERIAL,address,2048)!=pages[i][0]:raise ValueError('live original flash page mismatch')
        original=read_fresh(a.device,CASE_SERIAL,BASE,SIZE);(a.output/'original-sram.bin').write_bytes(original)
        for page in (0,1):
            # Deliberately no mode argument: this runner cannot request patch/restore.
            cfg=request(page,2,0x514c0001+page)
            image=bytearray(original);image[:len(payload)]=payload
            image[0x3a00:0x3b00]=bytes(256);image[0x3f00:0x3f20]=cfg
            dirty=True;put_all(a.device,bytes(image))
            if frozen!={n:sha(Path(n).read_bytes()) for n in frozen}:raise ValueError('qualification source changed')
            with bound_rom(a.device,CASE_SERIAL) as port:
                if read_memory(port,0x20013f00,32,attempts=1)!=cfg:raise ValueError('mode2 request readback mismatch')
                try:go_sram(port);ack=True
                except Exception:ack=False
                port.dtr=True;time.sleep(0.25)
            raw=read_fresh(a.device,CASE_SERIAL,0x20013a00,256);result=decode(raw)
            (a.output/f'page{page}-result.bin').write_bytes(raw)
            if result['status']!=0 or result['mode']!=2 or result['page']!=page or result['nonce']!=0x514c0001+page or result['eraseStarts'] or result['programDoublewords'] or result['controllerRestored']:raise ValueError('read-only mode result not qualified')
            if read_fresh(a.device,CASE_SERIAL,0x20013f00,8)!=bytes(8):raise ValueError('one-shot request not consumed')
            report['rows'].append({'page':page,'launchAcknowledged':ack,'result':result});print(f'QUALIFIED page{page}: no erase/program/controller writes',flush=True)
        for i,address in enumerate((0x08009800,0x0800d800)):
            if read_fresh(a.device,CASE_SERIAL,address,2048)!=pages[i][0]:raise ValueError('stock page changed during read-only test')
        report['fullCandidatePagesUnchangedAfter']=True;report['outcome']='both-pages-read-only-qualified'
    except Exception as e:report['error']=str(e);report['outcome']='failed-closed'
    finally:
        if dirty and original is not None:
            try:put_all(a.device,original);report['originalSramRestoredAndVerified']=True
            except Exception as e:report['sramRestoreError']=str(e);report['outcome']='sram-restore-unverified'
        if touched:
            try:report['stockVersionRestored']=restore_application(a.device,expected_version='1.2.57')
            except Exception as e:report['stockRestoreError']=str(e);report['outcome']='stock-restore-unverified'
        report['finishedAt']=datetime.now(timezone.utc).isoformat()
        (a.output/'audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('preflight','sourceHashes')},indent=2),flush=True)
    return 0 if report['outcome']=='both-pages-read-only-qualified' else 2
if __name__=='__main__':raise SystemExit(main())
