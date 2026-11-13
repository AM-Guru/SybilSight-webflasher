"""Inspect HELLO-only patched case artifacts without serial access."""
import json
from pathlib import Path
from case_sbl_reset_prepared.trace import CASE_SHA256
from case_native_task_recovery.build import encode_bl
def inspect_build(directory,reference):
    from case_native_task_hello.build import SOURCES,sha
    from case_native_task_hello.validate import CASES
    root=Path(__file__).resolve().parent;m=json.loads((directory/'validated-manifest.json').read_text())
    stock=reference.read_bytes()[32:]
    if sha(stock)!=CASE_SHA256 or m.get('stockCodeSha256')!=CASE_SHA256:raise ValueError('wrong stock code')
    if (m.get('schemaVersion'),m.get('operation'))!=(11,'native-rtos-pulse-hello-discovery'):raise ValueError('wrong HELLO operation')
    if set(m.get('sourceHashes',{}))!=set(SOURCES) or any(sha((root/n).read_bytes())!=v for n,v in m['sourceHashes'].items()):raise ValueError('HELLO source provenance differs')
    b={n:(directory/f'{n}.bin').read_bytes() for n in ('hook','trampoline','patched-case')}
    for n,prefix in (('hook','payload'),('trampoline','trampoline'),('patched-case','patchedCase')):
        if (m.get(prefix+'Bytes'),m.get(prefix+'Sha256'))!=(len(b[n]),sha(b[n])):raise ValueError('HELLO artifact identity differs')
    if not 0<len(b['hook'])<0x1800 or not 0<len(b['trampoline'])<=0x630:raise ValueError('HELLO storage bounds differ')
    expected=bytearray(stock+b'\xff'*(0xd9d0-len(stock))+b['trampoline'])
    for site in (0x9afa,0x9b10):expected[site:site+4]=encode_bl(0x08000000+site,0x0800d9d0)
    if b['patched-case']!=bytes(expected):raise ValueError('change outside exact hook sites/tail')
    if m.get('templeCommandAllowlist')!=['14559de900000800'] or m.get('maxTempleBytes')!=160 or m.get('rtosTickReconfigured') is not False or m.get('glassesFirmwareWriteImplemented') is not False or m.get('hardwareValidated') is not False or m.get('compiledValidationComplete') is not True:raise ValueError('unexpected capability/proof claim')
    rows=m.get('cases',[])
    if len(rows)!=len(CASES) or {r.get('case') for r in rows}!=set(CASES) or not all(r.get('passed') is True for r in rows):raise ValueError('incomplete emitted-code coverage')
    return m,b
