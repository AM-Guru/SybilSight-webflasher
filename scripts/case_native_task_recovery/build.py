#!/usr/bin/env python3
"""Build a guarded stock-task context hook; no device access or flash writer."""
import argparse,hashlib,json,struct,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from case_sbl_reset_prepared.trace import CASE_SHA256,fnv
ROOT=Path(__file__).resolve().parent
SOURCES=('hook.c','trampoline.c','hook.ld','trampoline.ld','build.py',
         'protocol.py','validate.py','artifacts.py','../case_sbl_reset_prepared/trace.py')

def encode_bl(source,target):
    delta=target-source-4
    if delta%2 or not -(1<<24)<=delta<(1<<24):raise ValueError('BL target out of range')
    imm=delta&0x1ffffff;s=(imm>>24)&1;i1=(imm>>23)&1;i2=(imm>>22)&1
    return struct.pack('<HH',0xf000|(s<<10)|((imm>>12)&0x3ff),0xd000|((1^(i1^s))<<13)|((1^(i2^s))<<11)|((imm>>1)&0x7ff))

def compile_one(name,out,definitions=()):
    subprocess.run(['/usr/bin/clang','--target=arm-none-eabi','-mcpu=cortex-m0plus','-mthumb','-Os','-ffreestanding','-fno-builtin','-Wall','-Wextra','-Werror',*definitions,'-c',str(ROOT/f'{name}.c'),'-o',str(out/f'{name}.o')],check=True)
    subprocess.run(['arm-none-eabi-ld','-T',str(ROOT/f'{name}.ld'),str(out/f'{name}.o'),'-o',str(out/f'{name}.elf')],check=True)
    subprocess.run(['arm-none-eabi-objcopy','-O','binary',str(out/f'{name}.elf'),str(out/f'{name}.bin')],check=True)
    return (out/f'{name}.bin').read_bytes()

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--case-reference',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if a.output.exists():p.error('build output must be fresh')
    code=a.case_reference.read_bytes()[32:]
    if hashlib.sha256(code).hexdigest()!=CASE_SHA256:raise ValueError('wrong stock image')
    a.output.mkdir(parents=True);frozen={s:hashlib.sha256((ROOT/s).read_bytes()).hexdigest() for s in SOURCES}
    hook=compile_one('hook',a.output)
    tramp=compile_one('trampoline',a.output,[f'-DPAYLOAD_BYTES={len(hook)}u',f'-DPAYLOAD_FNV={fnv(hook)}u'])
    patched=bytearray(code+b'\xff'*(0xd9d0-len(code))+tramp)
    for site in (0x9afa,0x9b10):
        if code[site:site+4]!=encode_bl(0x08000000+site,0x0800b678):raise ValueError('wrong native pulse call')
        patched[site:site+4]=encode_bl(0x08000000+site,0x0800d9d0)
    (a.output/'patched-case.bin').write_bytes(patched)
    if frozen!={s:hashlib.sha256((ROOT/s).read_bytes()).hexdigest() for s in SOURCES}:raise ValueError('build source changed')
    manifest={'schemaVersion':9,'operation':'native-task-context-qualification-only','stockCodeSha256':CASE_SHA256,
      'payloadBytes':len(hook),'payloadSha256':hashlib.sha256(hook).hexdigest(),'payloadFnv':fnv(hook),'sramEntry':'0x20010001',
      'trampolineAddress':'0x0800d9d0','trampolineBytes':len(tramp),'trampolineSha256':hashlib.sha256(tramp).hexdigest(),
      'patchedCaseBytes':len(patched),'patchedCaseSha256':hashlib.sha256(patched).hexdigest(),
      'patchCallSites':['0x08009afa','0x08009b10'],'candidateChangedPages':['0x08009800','0x0800d800'],
      'sourceHashes':frozen,'compiledValidationComplete':False,'hardwareValidated':False,'flashWriterImplemented':False,
      'templeFirmwareWriteImplemented':False,'templeCommandBytesImplemented':0,'hardwareNativeTaskExecutionVerified':False,
      'boundary':'Offline native instruction validation; task delays and kernel state are fixtures. No physical reset or hardware hook execution proved.'}
    (a.output/'build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({k:manifest[k] for k in ['payloadBytes','trampolineBytes','patchedCaseBytes','compiledValidationComplete']}))
    from case_native_task_recovery.validate import validate
    cases=validate(a.case_reference.read_bytes(),bytes(patched),hook)
    if frozen!={s:hashlib.sha256((ROOT/s).read_bytes()).hexdigest() for s in SOURCES}:raise ValueError('validation source changed')
    manifest.update(compiledValidationComplete=True,cases=cases)
    (a.output/'validated-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'Passed compiled context cases: {len(cases)}',flush=True)
if __name__=='__main__':main()
