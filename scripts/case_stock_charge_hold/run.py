#!/usr/bin/env python3
"""Run the validated, fixed sensing program only in charging-Case SRAM.

No flash erase/program or option-byte writes. Only a fixed version query or
Ambiq HELLO is sent over temple UART; the HELLO variants emit a stock reset
waveform. No arbitrary bus commands or firmware payloads are accepted.
"""
import argparse, hashlib, json, re, struct, sys, time
from datetime import datetime, timezone
from pathlib import Path
import serial
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from g2_case_rom import open_rom_loader, require_expected_identity, read_memory, write_sram, go_sram, restore_application
from g2_case_pogo_flasher import _drain_case_console, parse_case_restore_evidence
from validate import fnv

RESULT=0x20011a00; SIZE=256; BASE=0x20010000
REFERENCE=Path('/Users/kalani/Repo/evenRealities-openCFW/g2/blobs/official/g2-2.2.6.10/firmware_box.bin')
CASE_CODE_SHA256='773b6d4cfdaf0a5a74a557e3babe8222a0ae813436b76a7437c1096d2c60d677'

def decode(data):
 if len(data)!=SIZE:raise ValueError('result length mismatch')
 words=struct.unpack_from('<12I',data)
 if words[0]!=0x31534e53 or words[1]!=4 or fnv(data[:-4])!=struct.unpack_from('<I',data,252)[0]:raise ValueError('result checksum/schema mismatch')
 baseline=data[48:58];restored=data[58:68]
 return {'status':words[2],'writeMask':hex(words[4]),'baselineHex':baseline.hex(),'restoredHex':restored.hex(),'exactRestorationVerified':words[5]==words[6]==0x3ff and baseline==restored and words[8]==0,'stage':words[9],'templeBytesSent':words[10],'resetCompleted':bool(words[11]),'uartErrorMask':hex(words[7]),'holdSecondsCompleted':words[3],'registers':[hex(x) for x in struct.unpack_from('<13I',data,200)],'boundary':'120-second hold of already-settled stockAF/AF state; all10bytes read everysecond, abort on change. Zero YHM writes, UART bytes, reset pulses, firmware bytes. Case sensing/communications policy paused; not a battery-current measurement.'}

def preflight(device,expected_serial):
 with serial.Serial(device,1000000,timeout=.05,write_timeout=1) as port:
  port.dtr=True;port.rts=False;time.sleep(.1);port.rts=True;time.sleep(.06);port.rts=False
  text=_drain_case_console(port,4)
  for command in (b'DEA3\n',b'DED3\n'):
   port.write(command);port.flush();text+=_drain_case_console(port,1)
 report=parse_case_restore_evidence(text,require_reset_confirmation=False)
 identities=re.findall(rb'B200 1\.2\.57 ([0-9A-Fa-f]{24})',text)
 if not identities or identities[-1].decode().upper()!=expected_serial.upper():raise ValueError('fresh Case serial mismatch')
 if not report['left_present'] or not report['right_present'] or report['ota_glasses']!=0:raise ValueError('both contacts and inactive OTA required')
 report.update({'caseSerial':identities[-1].decode(),'rawConsole':text.decode(errors='replace')})
 return report

def main():
 parser=argparse.ArgumentParser(description='Pinned SRAM stock right-reset and exact Ambiq HELLO; no flash writes')
 parser.add_argument('--device',required=True);parser.add_argument('--case-serial',required=True)
 parser.add_argument('--pair-label',required=True);parser.add_argument('--build',type=Path,required=True)
 parser.add_argument('--output',type=Path,required=True);parser.add_argument('--execute-fixed-readonly-probe','--execute-right-reset-and-hello',action='store_true',required=True)
 args=parser.parse_args();parser.error('Original hold runner disabled after incomplete18-second hardware result; use qualified case_stock_charge_hold_v2 instead.');args.output.parent.mkdir(parents=True,exist_ok=True)
 audit={'schemaVersion':1,'capturedAt':datetime.now(timezone.utc).isoformat(),'pairLabel':args.pair_label,'firmwareBytesSent':0,'templeBytesSent':0,'caseFlashWrites':0,'outcome':'not-started'}
 touched=False
 try:
  manifest=json.loads((args.build/'validated-manifest.json').read_text());payload=(args.build/'bridge.bin').read_bytes()
  if hashlib.sha256(payload).hexdigest()!=manifest['payloadSha256'] or manifest['payloadBytes']!=len(payload) or len(manifest['cases'])!=6:raise ValueError('validated payload mismatch')
  for name,digest in manifest['sourceHashes'].items():
   if hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest()!=digest:raise ValueError('source changed after validation')
  if not 8<len(payload)<0x1800 or struct.unpack_from('<I',payload)[0]!=0x20014000:raise ValueError('SRAM layout mismatch')
  audit['bridgeSha256']=manifest['payloadSha256'];audit['preflight']=preflight(args.device,args.case_serial)
  reference=REFERENCE.read_bytes()[32:]
  # One immutable-stock reference: retain exact bytes and verify before calls.
  audit['caseCodeReferenceSha256']=hashlib.sha256(reference).hexdigest()
  if audit['caseCodeReferenceSha256']!=CASE_CODE_SHA256:raise ValueError('local Case reference pin mismatch')
  touched=True
  with open_rom_loader(args.device) as port:
   require_expected_identity(port)
   live=bytearray()
   for offset in range(0,len(reference),256):live.extend(read_memory(port,0x08000000+offset,min(256,len(reference)-offset),attempts=2))
   audit['liveCaseCodeSha256']=hashlib.sha256(live).hexdigest()
   if bytes(live)!=reference:raise ValueError('live Case code differs from pinned stock reference; no SRAM code uploaded')
   padded=payload+b'\0'*((-len(payload))%4)
   audit['sramCodeBytesUploaded']=len(padded);audit['sramResultBytesCleared']=SIZE
   allowed={BASE+offset:padded[offset:offset+256] for offset in range(0,len(padded),256)}
   allowed.update({RESULT+offset:bytes(min(256,SIZE-offset)) for offset in range(0,SIZE,256)})
   for address,block in allowed.items():
    if not ((BASE<=address<BASE+len(padded)) or (RESULT<=address<RESULT+SIZE)):raise ValueError('SRAM write outside exact allowlist')
    write_sram(port,address,block)
    if read_memory(port,address,len(block),attempts=2)!=block:raise ValueError('SRAM upload readback mismatch')
   go_sram(port);port.dtr=True
   audit['volatileCodeExecuted']=True
   # Fixed capture, no command interpreter. Reset to ROM to acquire retained result.
   for _ in range(9):time.sleep(15)
  with open_rom_loader(args.device) as port:
   require_expected_identity(port)
   data=b''.join(read_memory(port,RESULT+offset,min(256,SIZE-offset),attempts=2) for offset in range(0,SIZE,256))
  args.output.with_suffix('.bin').write_bytes(data)
  audit['result']=decode(data)
  audit['templeBytesSent']=audit['result']['templeBytesSent']
  if audit['result']['status'] or not audit['result']['exactRestorationVerified']:raise ValueError('bridge stopped safely or restoration not proven')
  audit['outcome']='capture-and-exact-restoration-verified'
 except Exception as error:audit['error']=str(error);audit['outcome']='failed-safely'
 finally:
  if touched:
   try:audit['restoredCaseVersion']=restore_application(args.device,expected_version='1.2.57')
   except Exception as error:audit['restoreError']=str(error);audit['outcome']='restore-not-verified'
  args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(audit,indent=2)+'\n')
 print(json.dumps(audit,indent=2));return 0 if audit['outcome']=='capture-and-exact-restoration-verified' else 1
if __name__=='__main__':sys.exit(main())
