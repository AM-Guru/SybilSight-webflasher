"""Offline inspection: accept only the exact two-site, tail-only case patch."""
import hashlib
import json
from pathlib import Path
from case_sbl_reset_prepared.trace import CASE_SHA256

def sha(data):return hashlib.sha256(data).hexdigest()

def inspect_build(directory,reference):
    from case_native_task_recovery.build import SOURCES,encode_bl
    from case_native_task_recovery.validate import CASES
    root=Path(__file__).resolve().parent
    m=json.loads((directory/'validated-manifest.json').read_text())
    stock=reference.read_bytes()[32:]
    if sha(stock)!=CASE_SHA256 or m.get('stockCodeSha256')!=CASE_SHA256:raise ValueError('wrong stock identity')
    if (m.get('schemaVersion'),m.get('operation'))!=(9,'native-task-context-qualification-only'):raise ValueError('wrong operation')
    if set(m.get('sourceHashes',{}))!=set(SOURCES):raise ValueError('incomplete source provenance')
    if any(sha((root/n).read_bytes())!=v for n,v in m['sourceHashes'].items()):raise ValueError('source changed')
    blobs={n:(directory/f'{n}.bin').read_bytes() for n in ('hook','trampoline','patched-case')}
    for n,prefix in [('hook','payload'),('trampoline','trampoline'),('patched-case','patchedCase')]:
        if (m.get(prefix+'Bytes'),m.get(prefix+'Sha256'))!=(len(blobs[n]),sha(blobs[n])):raise ValueError('artifact identity mismatch')
    if not 0<len(blobs['hook'])<0x1800 or not 0<len(blobs['trampoline'])<=0x630:raise ValueError('code outside allowed storage')
    expected=bytearray(stock+b'\xff'*(0xd9d0-len(stock))+blobs['trampoline'])
    for site in (0x9afa,0x9b10):
        if stock[site:site+4]!=encode_bl(0x08000000+site,0x0800b678):raise ValueError('wrong stock call site')
        expected[site:site+4]=encode_bl(0x08000000+site,0x0800d9d0)
    if bytes(expected)!=blobs['patched-case']:raise ValueError('patch outside two call sites and erased tail')
    if (m.get('sramEntry'),m.get('trampolineAddress'),m.get('patchCallSites'),m.get('candidateChangedPages'))!=('0x20010001','0x0800d9d0',['0x08009afa','0x08009b10'],['0x08009800','0x0800d800']):raise ValueError('unexpected layout')
    if m.get('compiledValidationComplete') is not True:raise ValueError('compiled validation incomplete')
    for field in ('hardwareValidated','hardwareNativeTaskExecutionVerified','flashWriterImplemented','templeFirmwareWriteImplemented'):
        if m.get(field) is not False:raise ValueError('offline artifact claims unimplemented hardware capability')
    if m.get('templeCommandBytesImplemented')!=0:raise ValueError('unexpected UART capability')
    cases=m.get('cases',[])
    if len(cases)!=len(CASES) or {r.get('case') for r in cases}!=set(CASES) or not all(r.get('passed') is True for r in cases):raise ValueError('incomplete compiled coverage')
    return m,blobs
