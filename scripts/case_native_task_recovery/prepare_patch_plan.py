#!/usr/bin/env python3
"""Prepare exact patch/restore page artifacts offline; cannot open a device."""
import argparse,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from case_native_task_recovery.artifacts import inspect_build,sha

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('build','case-reference','storage-qualification','mapping-audit','bank-audit','output'):
        p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args()
    if a.output.exists():p.error('output must be fresh')
    m,b=inspect_build(a.build,a.case_reference)
    s=json.loads(a.storage_qualification.read_text());r=json.loads(a.mapping_audit.read_text());bank=json.loads(a.bank_audit.read_text())
    if s.get('outcome')!='retention-and-erased-tail-qualified' or s.get('flashWrites')!=0 or s.get('stockRestored') is not True or s.get('originalSramRestoredAndVerified') is not True or s.get('retainedAllBytes') is not True or s.get('flashSizeKiB')!=512:raise ValueError('storage not qualified')
    if len(s.get('caseCodeReadbacks',[]))!=2 or not all(row['matchesPinnedReference'] and row['sha256']==m['stockCodeSha256'] for row in s['caseCodeReadbacks']):raise ValueError('two matching full code reads required')
    if r.get('outcome')!='effective-registers-read' or r.get('caseSerial')!=s['caseSerial'] or r.get('originalSramRestored') is not True or r.get('stockVersionRestored')!='1.2.57' or r.get('flashWrites')!=0:raise ValueError('mapping audit not qualified')
    if r['result']!={'optr':'0xdeefe1aa','acr':'0x600','cr':'0xc0000000','sr':'0x0','nSwapBankBit':0,'dualBankBit':1,'rdpByte':'0xaa'}:raise ValueError('effective register fixture differs; mapping must be re-reviewed')
    if bank.get('passed') is not True or bank.get('currentReadOnlyOptr')!=r['result']['optr'] or bank.get('currentStockBankSelection')!=2 or len(bank.get('cases',[]))!=18 or not all(row['passed'] for row in bank['cases']):raise ValueError('native stock bank audit incomplete')
    if len(s.get('pages',[]))!=2:raise ValueError('both complete saved pages required')
    stock=a.case_reference.read_bytes()[32:];pages=[]
    for row,address in zip(s['pages'],(0x08009800,0x0800d800)):
        if int(row['address'],16)!=address or row['bytes']!=2048:raise ValueError('wrong saved page bounds/order')
        original=(a.storage_qualification.parent/row['saved']).read_bytes();offset=address-0x08000000
        if len(original)!=2048 or sha(original)!=row['sha256']:raise ValueError('saved page identity mismatch')
        prefix=stock[offset:offset+2048]
        if original[:len(prefix)]!=prefix or original[len(prefix):]!=b'\xff'*(2048-len(prefix)):raise ValueError('saved page differs from stock plus erased tail')
        modified=bytearray(original);replacement=b['patched-case'][offset:offset+2048];modified[:len(replacement)]=replacement
        pages.append({'address':hex(address),'bytes':2048,'bankLocalPage':offset//2048,'physicalBankSelectedByStock':2,
          'originalSha256':sha(original),'patchedSha256':sha(modified),'original':original,'patched':bytes(modified)})
    a.output.mkdir(parents=True)
    for row in pages:
        address=int(row['address'],16)
        for kind in ('original','patched'):
            filename=f'{kind}-{address:08x}.bin';(a.output/filename).write_bytes(row.pop(kind));row[kind+'File']=filename
    report={'operation':'offline-two-page-native-task-context-plan','executionReady':False,'caseSerial':s['caseSerial'],
      'pages':pages,'effectiveFlashOptr':r['result']['optr'],'physicalBankSelectionBasis':'actual stock code + read-only effective OPTR; no ROM erase-command index mapping asserted',
      'patchOrder':['0x0800d800','0x08009800'],'restoreOrder':['0x08009800','0x0800d800'],
      'hardwareFlashWrites':0,'templeCommandBytes':0,'templeFirmwareImageBytes':0,
      'remainingGates':['Implement exact-page backend and validate its register/address allowlist, timeouts, partial-operation handling and restore path.',
        'Reverify bound UID, live code/pages and effective registers immediately before any mutation.',
        'No normal application boot while either page lacks complete verified contents.'],
      'boundary':'Plan files only. No flash writer, erase command, option-byte mutation, case-hook installation or hardware native-task execution is implemented by this tool.'}
    (a.output/'plan.json').write_text(json.dumps(report,indent=2)+'\n');print('Prepared two exact patch pages and two restore pages; executionReady=false; no hardware access.')
if __name__=='__main__':main()
