#!/usr/bin/env python3
"""Console logger: DEA3 + DEAA every 10s; abort + swapback if temp>45C.
Parses live YHM regs from DEAA and asserts continuous right 5V (reg4=AF, reg6!=right-sense).
"""
import serial, time, re, sys, json, subprocess
from pathlib import Path

DEV = '/dev/cu.usbserial-210'
dur = int(sys.argv[1])
out = Path(sys.argv[2])
here = Path(__file__).parent
pat = re.compile(
  rb'B200\s+vol:(-?\d+)\s+pct:(-?\d+),\s*open:(\d+),\s*usb:(\d+),\s*cur:(-?\d+),\s*'
  rb'GLS_L:(\d+),\s*GLS_R:(\d+)\s+temp:(-?\d+)'
)
# Live DEAA line often: "0x00-0x07:81 11 4 af af 3 81 20" then "2510: 0x00-0x07:..."
yhm = re.compile(
  rb'(?:2510:\s*)?0x00-0x07:([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+'
  rb'([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)'
)
rchg = re.compile(rb'R charging:(\d+),\s*done:(\d+),\s*vol:(-?\d+)mv,\s*bat:(-?\d+),\s*cur:(-?\d+)')
lchg = re.compile(rb'L charging:(\d+),\s*done:(\d+),\s*vol:(-?\d+)mv,\s*bat:(-?\d+),\s*cur:(-?\d+)')

BAD_RIGHT_MUX = {0x8D, 0x87}  # right water / right presence
summary = dict(
  samples=0, yhmSamples=0, reg4_af=0, reg4_not_af=0, reg6_bad=0,
  gls_r_1=0, gls_r_0=0, r_charging_1=0, maxTemp=0, abort=None,
  reg4_values={}, reg6_values={}, last=None,
)

p = serial.Serial(); p.port = DEV; p.baudrate = 1000000; p.timeout = .2
p.dtr = True; p.rts = False; p.open()
t0 = time.time(); f = out.open('a'); last = 0; hot = 0; toggle = 0
f.write(f'### logger start dur={dur}s at {time.strftime("%Y-%m-%d %H:%M:%S %Z")}\n'); f.flush()

while time.time() - t0 < dur:
  if time.time() - last > 10:
    # alternate DEA3 / DEAA each cycle so we get both status and live regs
    cmd = b'DEAA\n' if toggle % 2 == 0 else b'DEA3\n'
    # every cycle send both
    p.write(b'DEA3\n'); time.sleep(0.05); p.write(b'DEAA\n')
    last = time.time(); toggle += 1
  d = p.read(4096)
  if not d:
    continue
  ts = time.strftime('%H:%M:%S')
  f.write(f'--- {ts}\n' + d.decode(errors='replace')); f.flush()
  for m in pat.finditer(d):
    v = [int(x) for x in m.groups()]
    temp = v[7] / 10 if v[7] > 150 else v[7]
    summary['samples'] += 1
    summary['maxTemp'] = max(summary['maxTemp'], temp)
    if v[6]: summary['gls_r_1'] += 1
    else: summary['gls_r_0'] += 1
    f.write(f'### pct={v[1]} vol={v[0]} usb={v[3]} cur={v[4]} GLS_L={v[5]} GLS_R={v[6]} temp={temp}\n')
    hot = hot + 1 if temp > 45 else 0
    if hot >= 2:
      summary['abort'] = 'TEMP>45C'
      f.write('### TEMP>45C -> swapping back to stock\n'); f.flush()
      f.close(); p.close()
      subprocess.run([sys.executable, str(here / 'flash.py'), 'swapback'],
                     stdout=out.open('a'), stderr=subprocess.STDOUT)
      (out.parent / 'cfw-v3-logger-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
      sys.exit(2)
  for m in yhm.finditer(d):
    regs = [int(x, 16) for x in m.groups()]
    summary['yhmSamples'] += 1
    r3, r4, r5, r6, r7 = regs[3], regs[4], regs[5], regs[6], regs[7]
    summary['reg4_values'][hex(r4)] = summary['reg4_values'].get(hex(r4), 0) + 1
    summary['reg6_values'][hex(r6)] = summary['reg6_values'].get(hex(r6), 0) + 1
    if r4 == 0xAF: summary['reg4_af'] += 1
    else: summary['reg4_not_af'] += 1
    if r6 in BAD_RIGHT_MUX: summary['reg6_bad'] += 1
    summary['last'] = dict(regs=[hex(x) for x in regs], r3=hex(r3), r4=hex(r4), r6=hex(r6), ts=ts)
    f.write(f'### YHM regs={[hex(x) for x in regs]} r4={hex(r4)} r6={hex(r6)}\n')
  for m in rchg.finditer(d):
    vv = [int(x) for x in m.groups()]
    if vv[0]: summary['r_charging_1'] += 1
    f.write(f'### R charging={vv[0]} done={vv[1]} vol={vv[2]} bat={vv[3]} cur={vv[4]}\n')
  for m in lchg.finditer(d):
    vv = [int(x) for x in m.groups()]
    f.write(f'### L charging={vv[0]} done={vv[1]} vol={vv[2]} bat={vv[3]} cur={vv[4]}\n')

p.close()
summary['elapsedSec'] = time.time() - t0
summary['continuousRightAF'] = summary['reg4_not_af'] == 0 and summary['yhmSamples'] > 0
summary['noRightSenseMux'] = summary['reg6_bad'] == 0
f.write(f'### logger done {json.dumps(summary)}\n'); f.close()
(out.parent / 'cfw-v3-logger-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
