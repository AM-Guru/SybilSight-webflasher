#!/usr/bin/env python3
"""Qualify changed-range SRAM staging with mode2-only case execution."""
import argparse,json,sys,time
from datetime import datetime,timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from case_native_task_flash.artifacts import inspect
from case_native_task_flash.build import CASE_SERIAL,source_paths,sha
from case_native_task_flash.protocol import request,decode
from case_native_task_flash.stager import Stager,BASE,SIZE
from case_sbl_discovery.run import preflight
from g2_case_rom import go_sram,restore_application,BootloaderError
ROOT=Path(__file__).resolve().parent

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--device',required=True)
    for name in ('build','plan','context-build','case-reference','output'):p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args()
    if a.output.exists():p.error('output must be fresh')
    _,payload,pages=inspect(a.build,a.plan,a.context_build,a.case_reference)
    paths=[Path(__file__),ROOT/'stager.py',ROOT/'artifacts.py',*source_paths(),ROOT/'../g2_case_rom.py',
      ROOT/'../case_native_task_recovery/rom_epochs.py',ROOT/'../case_sbl_discovery/run.py',ROOT/'../g2_case_pogo_flasher.py',
      a.build/'writer.bin',a.build/'validated-writer.json',a.build/'pages.h',a.case_reference]
    frozen={str(path.resolve()):sha(path.read_bytes()) for path in paths}
    a.output.mkdir(parents=True);(a.output/'source-snapshot').mkdir()
    for i,name in enumerate(frozen):(a.output/'source-snapshot'/f'{i:02}-{Path(name).name}').write_bytes(Path(name).read_bytes())
    report={'operation':'changed-range-sram-staging-qualification','startedAt':datetime.now(timezone.utc).isoformat(),
      'caseSerial':CASE_SERIAL,'writerPayloadSha256':sha(payload),'sourceHashes':frozen,'rows':[],'romTransferEvents':[],
      'flashWrites':0,'customTempleQueryBytes':0,'glassesFirmwareImageBytes':0,'outcome':'not-started'}
    s=Stager(a.device,events=report['romTransferEvents'],bad_reads=a.output/'read-diagnostics')
    old=None;dirty=False;touched=False
    try:
        report['preflight']=preflight(a.device,CASE_SERIAL,'left');touched=True
        stock=a.case_reference.read_bytes()[32:];s.verify(0x08000000,stock,label='preflight stock')
        for page,address in enumerate((0x08009800,0x0800d800)):s.verify(address,pages[page][0],label='original case page')
        old=s.read(BASE,SIZE);(a.output/'original-sram.bin').write_bytes(old);report['originalSramSha256']=sha(old)
        for page in (0,1):
            cfg=request(page,2,0x53510001+page);dirty=True;before=s.bytes_written
            s.stage_writer(payload,cfg);s.verify(BASE,payload,label='complete SRAM writer')
            if any(sha(Path(n).read_bytes())!=v for n,v in frozen.items()):raise ValueError('staging qualification source/input changed')
            with s.connect(verify_address=0x20013f00,expected=cfg) as port:
                try:go_sram(port);ack=True
                except (BootloaderError,OSError):ack=False
                finally:port.dtr=True;time.sleep(0.25)
            raw=s.read(0x20013a00,256);r=decode(raw);(a.output/f'page{page}-result.bin').write_bytes(raw)
            if r['status'] or r['mode']!=2 or r['page']!=page or r['nonce']!=0x53510001+page or r['eraseStarts'] or r['programDoublewords'] or r['busyAtEnd']:raise ValueError('mode2 evidence not qualified')
            s.verify(0x20013f00,bytes(8),label='consumed mode2 request')
            report['rows'].append({'page':page,'launchAcknowledged':ack,'result':r,'stagingBytesAttempted':s.bytes_written-before})
            print(f'QUALIFIED mode2 page{page}: staged {s.bytes_written-before} bytes; no flash operations',flush=True)
        for page,address in enumerate((0x08009800,0x0800d800)):s.verify(address,pages[page][0],label='unchanged original case page')
        report['candidatePagesUnchanged']=True;report['outcome']='mode2-and-original-restore-verified'
    except Exception as error:report['error']=str(error);report['outcome']='failed-closed'
    finally:
        report['stagingBytesAttemptedBeforeRestore']=s.bytes_written
        if dirty and old is not None:
            try:
                s.restore(old);report['originalSramRestoredAndVerified']=True
            except Exception as error:report['sramRestoreError']=str(error);report['outcome']='sram-restore-unverified'
        if touched:
            try:report['stockVersionRestored']=restore_application(a.device,expected_version='1.2.57')
            except Exception as error:report['stockRestoreError']=str(error);report['outcome']='stock-restore-unverified'
        report['totalSramBytesAttempted']=s.bytes_written;report['unchangedEpochsSkipped']=s.epochs_skipped
        report['finishedAt']=datetime.now(timezone.utc).isoformat()
        (a.output/'audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('sourceHashes','preflight','romTransferEvents')},indent=2),flush=True)
    return 0 if report['outcome']=='mode2-and-original-restore-verified' else 2
if __name__=='__main__':raise SystemExit(main())
