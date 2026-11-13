#!/usr/bin/env python3
"""Capture fresh case identity/presence/OTA proof, then optionally one DEB0."""
import argparse,json,re,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from case_native_task_flash.build import CASE_SERIAL,sha
from g2_case_pogo_flasher import (_open_case_console,_drain_case_console,
    parse_case_restore_evidence,SafetyError,FINAL_RESET_COMMAND,FINAL_RESET_CONFIRMATION)

def checked_console(device,output,*,send_reset=False):
    output=Path(output)
    if output.exists():raise ValueError('fresh console capture directory required')
    output.mkdir(parents=True);source=Path(__file__).read_bytes();(output/'source-console_reset.py').write_bytes(source)
    captured=bytearray();r={'operation':'captured-case-console-preflight','sourceSha256':sha(source),'reset_sent':False,'reset_confirmed':False,'queryRounds':0}
    try:
        with _open_case_console(device) as port:
            captured.extend(_drain_case_console(port,3.0))
            for attempt in range(1,4):
                r['queryRounds']=attempt
                for command in (b'DEA0\n',b'DEA3\n',b'DED3\n'):
                    if port.write(command)!=len(command):raise ValueError('truncated case diagnostic query')
                    port.flush();captured.extend(_drain_case_console(port,1.0))
                try:proof=parse_case_restore_evidence(bytes(captured),require_reset_confirmation=False)
                except SafetyError as error:
                    r.setdefault('telemetryErrors',[]).append(str(error))
                    if 'telemetry' not in str(error) or attempt==3:raise
                    continue
                identities=re.findall(rb'B200 1\.2\.57 ([0-9A-Fa-f]{24})',captured)
                if not identities or identities[-1].decode().upper()!=CASE_SERIAL:raise ValueError('fresh case serial differs or missing')
                if not proof['left_present'] or not proof['right_present']:raise ValueError('actual presence report does not show both temples')
                if proof['ota_glasses']!=0:raise ValueError('case reports active temple OTA')
                # The legacy parser names DEB0 even when no reset was sent.
                # This report records reset fields only from this operation.
                r.update({k:v for k,v in proof.items() if k not in ('reset_command','reset_confirmed')});r['caseSerial']=CASE_SERIAL
                break
            if send_reset:
                # Clear only the host's receive buffer after proof; do not
                # reopen/reset the MCU between proof and the one command.
                port.reset_input_buffer()
                r['reset_sent']=True;r['reset_command']='DEB0'
                if port.write(FINAL_RESET_COMMAND)!=len(FINAL_RESET_COMMAND):raise ValueError('truncated stock reset command')
                port.flush();deadline=time.monotonic()+1.2;confirmation=bytearray()
                while time.monotonic()<deadline:
                    confirmation.extend(port.read(4096))
                    if FINAL_RESET_CONFIRMATION.search(confirmation):break
                captured.extend(confirmation);r['confirmation_hex']=bytes(confirmation).hex()
                if not FINAL_RESET_CONFIRMATION.search(confirmation):raise ValueError('single stock reset not confirmed; command not replayed')
                r['reset_confirmed']=True
            r['outcome']='reset-confirmed' if send_reset else 'presence-only-verified'
    except Exception as error:r['error']=str(error);r['outcome']='failed-closed';raise
    finally:
        (output/'console.txt').write_bytes(captured)
        (output/'audit.json').write_text(json.dumps(r,indent=2)+'\n')
    return r

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--device',required=True);p.add_argument('--output',type=Path,required=True)
    mode=p.add_mutually_exclusive_group(required=True);mode.add_argument('--presence-only',action='store_true');mode.add_argument('--execute-stock-reset',action='store_true')
    a=p.parse_args();r=checked_console(a.device,a.output,send_reset=a.execute_stock_reset);print(json.dumps(r,indent=2))
if __name__=='__main__':main()
