#!/usr/bin/env python3
"""Build an exact-content case writer and validate emitted instructions offline."""
import argparse,hashlib,json,os,struct,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from case_native_task_recovery.artifacts import inspect_build
from case_native_task_recovery.build import SOURCES as CONTEXT_SOURCES
ROOT=Path(__file__).resolve().parent
SOURCES=('writer.c','start.S','link.ld','protocol.py','build.py','validate.py')
CASE_SERIAL='002300405845501620373941'

def sha(b):return hashlib.sha256(b).hexdigest()

def load_pages(plan,context_build,reference):
    m,b=inspect_build(context_build,reference)
    r=json.loads((plan/'plan.json').read_text())
    if r['operation']!='offline-two-page-native-task-context-plan' or r['caseSerial']!=CASE_SERIAL or r['effectiveFlashOptr']!='0xdeefe1aa' or len(r['pages'])!=2:raise ValueError('unexpected plan/case/options')
    stock=reference.read_bytes()[32:];pages=[]
    for row,address in zip(r['pages'],(0x08009800,0x0800d800)):
        if int(row['address'],16)!=address or row['bankLocalPage']!=(address-0x08000000)//2048 or row['physicalBankSelectedByStock']!=2 or row['bytes']!=2048:raise ValueError('wrong exact page layout')
        off=address-0x08000000
        expected=(stock[off:off+2048]).ljust(2048,b'\xff')
        patch=(b['patched-case'][off:off+2048]).ljust(2048,b'\xff')
        pair=[]
        for kind,value in [('original',expected),('patched',patch)]:
            data=(plan/row[kind+'File']).read_bytes()
            if data!=value or sha(data)!=row[kind+'Sha256']:raise ValueError('plan data differs from exact stock/validated patch')
            pair.append(data)
        pages.append(pair)
    return pages

def source_paths():
    return [ROOT/n for n in SOURCES]+[ROOT/'../case_native_task_recovery'/n for n in CONTEXT_SOURCES]

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for n in ('plan','context-build','case-reference','output'):p.add_argument('--'+n,type=Path,required=True)
    a=p.parse_args()
    if a.output.exists():p.error('output must be fresh')
    pages=load_pages(a.plan,a.context_build,a.case_reference)
    frozen={os.path.relpath(p,ROOT):sha(p.read_bytes()) for p in source_paths()}
    a.output.mkdir(parents=True)
    rows=[f'#define CASE_UID{i} 0x{CASE_SERIAL[8*i:8*i+8]}u' for i in range(3)]
    for page,pair in enumerate(pages):
        for kind,data in zip(('original','patched'),pair):
            words=struct.unpack('<512I',data)
            rows.append(f'static const uint32_t {kind}{page}[512]={{'+','.join(f'0x{v:08x}u' for v in words)+'};')
    (a.output/'pages.h').write_text('\n'.join(rows)+'\n')
    for stem,suffix in [('writer','c'),('start','S')]:
        subprocess.run(['/usr/bin/clang','--target=arm-none-eabi','-mcpu=cortex-m0plus','-mthumb','-Os','-ffreestanding','-fno-builtin','-Wall','-Wextra','-Werror','-I',str(a.output),'-c',str(ROOT/f'{stem}.{suffix}'),'-o',str(a.output/f'{stem}.o')],check=True)
    subprocess.run(['arm-none-eabi-ld','-T',str(ROOT/'link.ld'),str(a.output/'start.o'),str(a.output/'writer.o'),'-o',str(a.output/'writer.elf')],check=True)
    subprocess.run(['arm-none-eabi-objcopy','-O','binary',str(a.output/'writer.elf'),str(a.output/'writer.bin')],check=True)
    payload=(a.output/'writer.bin').read_bytes()
    from case_native_task_flash.validate import validate
    report={'operation':'compiled-exact-case-page-writer','caseSerial':CASE_SERIAL,'payloadBytes':len(payload),'payloadSha256':sha(payload),
      'sourceHashes':frozen,'pagesHeaderSha256':sha((a.output/'pages.h').read_bytes()),'passed':False,'cases':[],
      'hardwareFlashWrites':0,'hardwareQualified':False,'hostMutationRunnerImplemented':False,
      'boundary':'Controller semantics and errors are fixtures. No physical erase/program/restore or ROM page-index mapping is proved.'}
    try:
        for row in validate(payload,pages):
            report['cases'].append(row);print(f'PASS {row["case"]}',flush=True)
        if frozen!={os.path.relpath(p,ROOT):sha(p.read_bytes()) for p in source_paths()}:raise ValueError('writer/validator source changed')
        report['passed']=True
    finally:(a.output/'validated-writer.json').write_text(json.dumps(report,indent=2)+'\n')
    print(f'Completed {len(report["cases"])} compiled writer cases; hardware writes:0.',flush=True)
if __name__=='__main__':main()
