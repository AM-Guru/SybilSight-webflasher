#!/usr/bin/env python3
"""Build emitted-code-validated native-task HELLO artifacts; offline only."""
import argparse,hashlib,json,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from case_sbl_reset_prepared.trace import CASE_SHA256,fnv
from case_native_task_recovery.build import encode_bl
ROOT=Path(__file__).resolve().parent
SOURCES=('hook.c','trampoline.c','hook.ld','trampoline.ld','build.py','protocol.py','validate.py','artifacts.py',
 '../case_native_task_recovery/build.py','../case_sbl_reset_prepared/trace.py','../g2_sbl_protocol.py')
def sha(data):return hashlib.sha256(data).hexdigest()
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--case-reference',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if a.output.exists():p.error('output must be fresh')
    stock=a.case_reference.read_bytes()[32:]
    if sha(stock)!=CASE_SHA256:raise ValueError('wrong stock reference')
    frozen={n:sha((ROOT/n).read_bytes()) for n in SOURCES};a.output.mkdir(parents=True)
    for name in ('hook','trampoline'):
        definitions=[] if name=='hook' else [f'-DPAYLOAD_BYTES={len(payload)}u',f'-DPAYLOAD_FNV={fnv(payload)}u']
        subprocess.run(['/usr/bin/clang','--target=arm-none-eabi','-mcpu=cortex-m0plus','-mthumb','-Os','-ffreestanding','-fno-builtin','-Wall','-Wextra','-Werror',*definitions,'-c',str(ROOT/f'{name}.c'),'-o',str(a.output/f'{name}.o')],check=True)
        subprocess.run(['arm-none-eabi-ld','-T',str(ROOT/f'{name}.ld'),str(a.output/f'{name}.o'),'-o',str(a.output/f'{name}.elf')],check=True)
        subprocess.run(['arm-none-eabi-objcopy','-O','binary',str(a.output/f'{name}.elf'),str(a.output/f'{name}.bin')],check=True)
        if name=='hook':payload=(a.output/'hook.bin').read_bytes()
    tramp=(a.output/'trampoline.bin').read_bytes();patched=bytearray(stock+b'\xff'*(0xd9d0-len(stock))+tramp)
    for site in (0x9afa,0x9b10):
        if stock[site:site+4]!=encode_bl(0x08000000+site,0x0800b678):raise ValueError('native call site differs')
        patched[site:site+4]=encode_bl(0x08000000+site,0x0800d9d0)
    (a.output/'patched-case.bin').write_bytes(patched)
    m={'schemaVersion':11,'operation':'native-rtos-pulse-hello-discovery','stockCodeSha256':CASE_SHA256,'sourceHashes':frozen,
      'payloadBytes':len(payload),'payloadSha256':sha(payload),'trampolineBytes':len(tramp),'trampolineSha256':sha(tramp),
      'patchedCaseBytes':len(patched),'patchedCaseSha256':sha(patched),'compiledValidationComplete':False,'hardwareValidated':False,
      'templeCommandAllowlist':['14559de900000800'],'maxTempleBytes':160,'rtosTickReconfigured':False,'glassesFirmwareWriteImplemented':False}
    from case_native_task_hello.validate import validate
    try:
        m['cases']=list(validate(a.case_reference.read_bytes(),bytes(patched),payload))
        if frozen!={n:sha((ROOT/n).read_bytes()) for n in SOURCES}:raise ValueError('source changed during validation')
        m['compiledValidationComplete']=True
    finally:(a.output/'validated-manifest.json').write_text(json.dumps(m,indent=2)+'\n')
    print(f'Completed {len(m["cases"])} compiled HELLO cases. Payload {len(payload)}, guard {len(tramp)} bytes; no hardware access.')
if __name__=='__main__':main()
