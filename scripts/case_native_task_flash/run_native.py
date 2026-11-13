#!/usr/bin/env python3
"""Bounded exact-page case patch/context/restore trial, or explicit restore-only."""
import argparse,json,os,secrets,shlex,sys,time
from datetime import datetime,timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from case_native_task_flash.artifacts import inspect
from case_native_task_flash.build import CASE_SERIAL,source_paths,sha
from case_native_task_flash.stager import Stager,BASE,SIZE
from case_native_task_flash.protocol import request,decode as decode_writer
from case_native_task_flash.transaction import trial
from case_native_task_recovery.artifacts import inspect_build
from case_native_task_recovery.protocol import configuration,decode as decode_context
from case_sbl_discovery.run import preflight
from g2_case_rom import go_sram,restore_application,BootloaderError
from case_native_task_flash.console_reset import checked_console
ROOT=Path(__file__).resolve().parent
ADDRESSES=(0x08009800,0x0800d800)
MIRRORS=(0x08049800,0x0804d800)

def validate_qualification(path,writer):
    q=json.loads(path.read_text())
    if q.get('operation')!='read-only-qualification-of-exact-page-writer' or q.get('caseSerial')!=CASE_SERIAL or q.get('payloadSha256')!=sha(writer) or q.get('outcome')!='both-pages-read-only-qualified' or q.get('originalSramRestoredAndVerified') is not True or q.get('stockVersionRestored')!='1.2.57' or q.get('fullCandidatePagesUnchangedAfter') is not True:raise ValueError('both live read-only qualifications and cleanup required')
    if len(q.get('rows',[]))!=2 or {r['page'] for r in q['rows']}!={0,1}:raise ValueError('incomplete live page coverage')
    for row in q['rows']:
        r=row['result']
        if r['status'] or r['mode']!=2 or r['page']!=row['page'] or r['eraseStarts'] or r['programDoublewords'] or r['busyAtEnd']:raise ValueError('invalid live read-only result')
    if any(sha(Path(n).read_bytes())!=v for n,v in q['sourceHashes'].items()):raise ValueError('qualified writer/transport source changed')

def validate_staging(path,writer):
    q=json.loads(path.read_text())
    if q.get('operation')!='changed-range-sram-staging-qualification' or q.get('caseSerial')!=CASE_SERIAL or q.get('writerPayloadSha256')!=sha(writer) or q.get('outcome')!='mode2-and-original-restore-verified' or q.get('originalSramRestoredAndVerified') is not True or q.get('candidatePagesUnchanged') is not True or q.get('stockVersionRestored')!='1.2.57':raise ValueError('changed-range staging not hardware-qualified')
    if len(q.get('rows',[]))!=2 or {r['page'] for r in q['rows']}!={0,1} or any(r['result']['status'] or r['result']['mode']!=2 or r['result']['eraseStarts'] or r['result']['programDoublewords'] for r in q['rows']):raise ValueError('staging mode2 coverage incomplete')
    if any(sha(Path(n).read_bytes())!=v for n,v in q['sourceHashes'].items()):raise ValueError('staging qualification source/input changed')

class CaseBackend:
    def __init__(self,args,report,writer,pages,context,original,mirrors,frozen,loader=None):
        self.a=args;self.report=report;self.writer=writer;self.pages=pages;self.context=context
        self.original=original;self.mirrors=mirrors;self.frozen=frozen
        self.stock=args.case_reference.read_bytes()[32:]
        self.loader=loader or Stager(args.device,events=report.setdefault('romTransferEvents',[]),bad_reads=args.output/'read-diagnostics')
    def save(self):
        p=self.a.output/'audit.json';temp=p.with_suffix('.json.tmp')
        with temp.open('w') as f:json.dump(self.report,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
        temp.replace(p)
    def check_sources(self):
        if any(sha(Path(n).read_bytes())!=v for n,v in self.frozen.items()):raise ValueError('trial source/input changed before mutation or context boot')
    def record_error(self,error):self.report['trialError']=str(error);self.save()
    def read(self,address,size):return self.loader.read(address,size)
    def verify(self,address,expected,label):self.loader.verify(address,expected,label=label)
    def read_page(self,page):
        if page not in (0,1):raise ValueError('unscoped page')
        return self.read(ADDRESSES[page],2048)
    def write_page(self,page,mode):
        if page not in (0,1) or mode not in (0,1):raise ValueError('unscoped page operation')
        if mode==0:self.check_sources()
        # Cleanup uses the already-verified bytes held in memory even if an
        # unrelated file changes. A file edit must not prevent restoration.
        nonce=secrets.randbits(32) or 1;cfg=request(page,mode,nonce)
        op={'page':page,'mode':mode,'nonce':nonce,'stage':'staging-sram','goCalls':0}
        self.report['pageOperations'].append(op);self.report['sramDirty']=True;self.save()
        print(f'PAGE {page} mode{mode}: staging exact changed SRAM ranges',flush=True)
        before=self.loader.bytes_written;self.loader.stage_writer(self.writer,cfg);op['sramBytesAttempted']=self.loader.bytes_written-before
        self.verify(BASE,self.writer,'complete SRAM writer')
        if mode==0:self.check_sources()
        with self.loader.connect(verify_address=0x20013f00,expected=cfg) as port:
            op['stage']='launch-uncertain';op['goCalls']=1;self.report['caseFlashMayBeChanged']=True;self.save()
            try:go_sram(port);op['goAcknowledged']=True
            except (BootloaderError,OSError) as e:op['goAcknowledged']=False;op['goAckError']=str(e)
            finally:
                # Never replay GO, including after a missing ACK. Allow the
                # bounded SRAM operation to finish before entering ROM again.
                port.dtr=True;time.sleep(2)
        raw=self.read(0x20013a00,256);(self.a.output/f'operation-{len(self.report["pageOperations"]):02}.bin').write_bytes(raw)
        r=decode_writer(raw);op['result']=r;op['stage']='result-collected';self.save()
        if r['status'] or r['mode']!=mode or r['page']!=page or r['nonce']!=nonce or r['address']!=hex(ADDRESSES[page]) or r['busyAtEnd']:raise ValueError(f'page writer did not complete successfully: {r}')
        self.verify(ADDRESSES[page],self.pages[page][1 if mode==0 else 0],'exact hardware page')
        self.verify(0x20013f00,bytes(8),'consumed writer request')
        for address,original in self.mirrors.items():
            self.verify(address,original,'opposite-bank mirror')
        op['stage']='exact-page-and-mirrors-verified';self.save()
        print(f'PAGE {page} mode{mode}: exact readback verified; erase={r["eraseStarts"]} program64={r["programDoublewords"]}',flush=True)
    def observe_context(self):
        routes=('left','right') if self.a.route=='both' else (self.a.route,)
        results={}
        for route in routes:
            self.report['activeContextRoute']=route;self.save()
            results[route]=self._observe_context_route(route)
            self.report.setdefault('nativeContexts',{})[route]=results[route];self.save()
        return results if self.a.route=='both' else results[self.a.route]
    def _observe_context_route(self,route):
        self.check_sources()
        self.verify(0x08000000,self.context['patched-case'],'complete patched case code')
        nonce=secrets.randbits(32) or 1;cfg=configuration(route,1000000,nonce)
        hook=self.context['hook']
        self.report['contextNonce']=nonce;self.report['sramDirty']=True;self.save()
        before=self.loader.bytes_written;self.loader.stage_context(hook,cfg);self.report['contextSramBytesAttempted']=self.loader.bytes_written-before
        self.verify(BASE,hook,'complete context hook');self.verify(0x20011f00,cfg,'context configuration')
        self.check_sources();self.report['contextBootStarted']=True;self.save()
        print('CONTEXT: one stock DEB0 reset in the same boot/console session',flush=True)
        reset=checked_console(self.a.device,self.a.output/f'console-{route}',send_reset=True)
        self.report['stockResetCommand']=reset
        self.report.setdefault('stockResetCommands',{})[route]=reset
        (self.a.output/f'native-context-{route}-reset.json').write_text(json.dumps(reset,indent=2)+'\n')
        if not reset['reset_confirmed'] or reset['case_version']!='1.2.57' or not reset['left_present'] or not reset['right_present']:raise ValueError('fresh bilateral reset/presence proof missing')
        # Confirmation is logged before the native pulse completes. Let both
        # stock side routines return before entering ROM for retained evidence.
        time.sleep(0.5)
        raw=self.read(0x20011a00,256);(self.a.output/f'native-context-{route}-result.bin').write_bytes(raw)
        r=decode_context(raw)
        if r['status'] or r['nonce']!=nonce or r['route']!=route:raise ValueError(f'native task context not qualified: {r}')
        self.verify(0x20011f00,bytes(8),'consumed context request')
        self.report['nativeContext']=r;self.save();print('CONTEXT: native task caller, return and checksummed evidence verified',flush=True)
        return r
    def verify_stock(self):
        stock=self.stock
        self.verify(0x08000000,stock,'complete original case code')
        for address,data in self.mirrors.items():
            self.verify(address,data,'restored mirror')
        self.report['caseFlashMayBeChanged']=False;self.report['fullOriginalCodeAndMirrorsVerified']=True;self.save()
    def restore_sram(self):
        print('RESTORE: original 32KiB SRAM snapshot',flush=True)
        self.loader.restore(self.original)
        self.report['sramDirty']=False;self.report['originalSramRestoredAndVerified']=True;self.save()
    def boot_stock(self):
        self.report['stockVersionRestored']=restore_application(self.a.device,expected_version='1.2.57');self.save()
    def hold_rom(self):
        with self.loader.connect():pass
        self.report['leftInRom']=True;self.save()

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--device',required=True)
    for n in ('build','plan','context-build','case-reference','read-only-qualification','output'):p.add_argument('--'+n,type=Path,required=True)
    p.add_argument('--staging-qualification',type=Path)
    p.add_argument('--route',choices=('left','right','both'),default='left')
    mode=p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--execute-case-context-trial',action='store_true')
    mode.add_argument('--restore-only-from',type=Path)
    a=p.parse_args()
    if a.execute_case_context_trial and not a.staging_qualification:p.error('a live changed-range staging qualification is required before a new trial')
    if a.output.exists():p.error('output must be fresh')
    m,writer,pages=inspect(a.build,a.plan,a.context_build,a.case_reference)
    _,context=inspect_build(a.context_build,a.case_reference)
    validate_qualification(a.read_only_qualification,writer)
    if a.staging_qualification:validate_staging(a.staging_qualification,writer)
    paths=[Path(__file__),ROOT/'transaction.py',ROOT/'qualify.py',ROOT/'stager.py',ROOT/'console_reset.py',ROOT/'artifacts.py',*source_paths(),
      ROOT/'../case_native_task_recovery/rom_epochs.py',ROOT/'../g2_case_rom.py',ROOT/'../case_sbl_discovery/run.py',ROOT/'../g2_case_pogo_flasher.py',
      a.build/'writer.bin',a.build/'validated-writer.json',a.build/'pages.h',a.case_reference,a.context_build/'hook.bin',a.context_build/'validated-manifest.json',a.read_only_qualification]
    if a.staging_qualification:paths.append(a.staging_qualification)
    frozen={str(path.resolve()):sha(path.read_bytes()) for path in paths}
    a.output.mkdir(parents=True);(a.output/'source-snapshot').mkdir()
    for i,name in enumerate(frozen):(a.output/'source-snapshot'/f'{i:02}-{Path(name).name}').write_bytes(Path(name).read_bytes())
    report={'operation':'native-case-task-context-trial','caseSerial':CASE_SERIAL,'startedAt':datetime.now(timezone.utc).isoformat(),
      'writerPayloadSha256':sha(writer),'sourceHashes':frozen,'pageOperations':[],'caseFlashMayBeChanged':False,'sramDirty':False,
      'customTempleQueryBytes':0,'templeFirmwareImageBytes':0,'physicalApolloResetVerified':False,'glassesRecovered':False,'outcome':'not-started','romTransferEvents':[]}
    loader=Stager(a.device,events=report['romTransferEvents'],bad_reads=a.output/'read-diagnostics')
    io=None;engine_started=False;stock_touched=False
    try:
        if a.restore_only_from:
            old=json.loads((a.restore_only_from/'audit.json').read_text());original=(a.restore_only_from/'original-sram.bin').read_bytes()
            if old['caseSerial']!=CASE_SERIAL or old['writerPayloadSha256']!=sha(writer) or old['originalSramSha256']!=sha(original) or len(original)!=SIZE:raise ValueError('restore snapshot identity/size differs')
            mirrors={int(row['address'],16):(a.restore_only_from/row['file']).read_bytes() for row in old['mirrorBackups']}
            if set(mirrors)!=set(MIRRORS) or any(sha(mirrors[int(row['address'],16)])!=row['sha256'] for row in old['mirrorBackups']):raise ValueError('restore mirror backup differs')
        else:
            report['preflight']=preflight(a.device,CASE_SERIAL,'left' if a.route=='both' else a.route);stock_touched=True
            stock=a.case_reference.read_bytes()[32:]
            print('PREFLIGHT: full original case code',flush=True);loader.verify(0x08000000,stock,label='preflight original code')
            for page,address in enumerate(ADDRESSES):
                loader.verify(address,pages[page][0],label='preflight original page')
            mirrors={address:loader.read(address,2048) for address in MIRRORS}
            original=loader.read(BASE,SIZE)
        (a.output/'original-sram.bin').write_bytes(original);report['originalSramSha256']=sha(original)
        report['mirrorBackups']=[]
        for address,data in mirrors.items():
            name=f'mirror-{address:08x}.bin';(a.output/name).write_bytes(data);report['mirrorBackups'].append({'address':hex(address),'file':name,'sha256':sha(data)})
        for page,pair in enumerate(pages):
            for kind,data in zip(('original','patched'),pair):(a.output/f'{kind}-{ADDRESSES[page]:08x}.bin').write_bytes(data)
        restore_args=[sys.executable,str(Path(__file__).resolve()),'--device',a.device]
        for name in ('build','plan','context_build','case_reference','read_only_qualification'):restore_args.extend(['--'+name.replace('_','-'),str(getattr(a,name).resolve())])
        if a.staging_qualification:restore_args.extend(['--staging-qualification',str(a.staging_qualification.resolve())])
        restore_args.extend(['--restore-only-from',str(a.output.resolve()),'--output',str(a.output.resolve())+'-restore'])
        (a.output/'restore-command.txt').write_text(shlex.join(restore_args)+'\n')
        io=CaseBackend(a,report,writer,pages,context,original,mirrors,frozen,loader=loader);io.save()
        engine_started=True
        result=trial(io,[p[0] for p in pages],[p[1] for p in pages],restore_only=bool(a.restore_only_from));report['transaction']=result
        report['outcome']='native-context-and-stock-restore-verified' if result['context'] and result['fullStockVerified'] and result['sramRestored'] and result['stockBooted'] and not result['error'] and not result['restoreErrors'] else 'stock-restored-context-not-qualified' if result['fullStockVerified'] and result['stockBooted'] else 'restore-unverified-hold-rom'
        if a.restore_only_from and result['fullStockVerified'] and result['sramRestored'] and result['stockBooted']:report['outcome']='restore-only-verified'
    except Exception as e:
        report['error']=str(e);report['outcome']='preflight-failed-no-flash-operation'
        if stock_touched and not engine_started:
            try:report['stockVersionRestored']=restore_application(a.device,expected_version='1.2.57')
            except Exception as cleanup:report['stockRestoreError']=str(cleanup)
    finally:
        report['finishedAt']=datetime.now(timezone.utc).isoformat()
        report['sramBytesAttempted']=loader.bytes_written;report['unchangedSramEpochsSkipped']=loader.epochs_skipped
        if io:io.save()
        else:(a.output/'audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('preflight','sourceHashes','romTransferEvents')},indent=2),flush=True)
    return 0 if report['outcome'] in ('native-context-and-stock-restore-verified','restore-only-verified') else 2
if __name__=='__main__':raise SystemExit(main())
