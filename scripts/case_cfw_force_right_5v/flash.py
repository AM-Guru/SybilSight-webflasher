#!/usr/bin/env python3
"""Port of webflasher stageCaseImage/activateStagedBank for force-right-5V CFW.
Phases: backup | verify | swapback | stage | activate
Never overwrites stock 1.2.57: only stages into inactive bank.
"""
import sys, hashlib, json, time, struct
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import g2_case_rom as R

DEV = '/dev/cu.usbserial-210'
OPT = 0x1fff7800
INACT = 0x08040000
W = Path.home() / 'Repo/SybilSight-webflasher/work/2026-10-27'
CFW = W / 'cfw-force-right-5v-v3/firmware_box_1.2.57_force_right_5v_v3.bin'
STOCK = '773b6d4cfdaf0a5a74a557e3babe8222a0ae813436b76a7437c1096d2c60d677'
V3 = '82da094ec3a6dfb007753d5fa97ea3debadb4ec442befb3e0b39afbb8952e9fd'
V2 = '00f69055a12e1d91f9897d7a7a712c2e55142cfc5466d264a71406c03a56353d'

def sha(b):
  return hashlib.sha256(b).hexdigest()

def rd(p, a, n):
  o = bytearray()
  for x in range(0, n, 256):
    o += R.read_memory(p, a + x, min(256, n - x), attempts=5)
  return bytes(o)

def dec(o):
  u, c = struct.unpack_from('<II', o)
  assert (~u) & 0xffffffff == c, 'opt complement'
  return dict(
    userWord=hex(u), rdp=hex(u & 0xff),
    swapBank=bool(u >> 20 & 1), dualBank=bool(u >> 22 & 1),
    active=1 if u >> 20 & 1 else 2,
    inactive=2 if u >> 20 & 1 else 1,
  )

def label(s):
  if s == STOCK: return 'stock-1.2.57'
  if s == V3: return 'cfw-v3-force-right-5v'
  if s == V2: return 'cfw-v2-force-right-5v'
  return 'unknown-' + s[:12]

def ack(p, what, t=30):
  old = p.timeout; p.timeout = t
  try: R.expect_ack(p, what)
  finally: p.timeout = old

def wmem(p, a, b, t=5):
  R.send_command(p, R.WRITE_MEMORY, 'Write')
  ab = a.to_bytes(4, 'big')
  p.write(ab + bytes([ab[0] ^ ab[1] ^ ab[2] ^ ab[3]])); p.flush()
  R.expect_ack(p, 'addr')
  body = bytes([len(b) - 1]) + b
  x = 0
  for v in body: x ^= v
  p.write(body + bytes([x])); p.flush()
  ack(p, 'data', t)

def flip_swap(o):
  u = struct.unpack_from('<I', o)[0] ^ (1 << 20)
  n = bytearray(o)
  struct.pack_into('<II', n, 0, u, (~u) & 0xffffffff)
  return bytes(n)

phase = sys.argv[1]
log = {}

if phase == 'backup':
  with R.open_rom_loader(DEV) as p:
    R.require_expected_identity(p)
    o = rd(p, OPT, 128)
    log['options'] = dec(o); log['optionsHex'] = o.hex()
    (W / 'case-backup-options.bin').write_bytes(o)
    for name, a in (('alias0x08000000_active', 0x08000000), ('alias0x08040000_inactive', INACT)):
      b = rd(p, a, 0x40000)
      (W / f'case-backup-{name}.bin').write_bytes(b)
      log[name] = dict(sha256=sha(b), first55752sha=sha(b[:55752]), label=label(sha(b[:55752])))

elif phase == 'verify':
  with R.open_rom_loader(DEV) as p:
    R.require_expected_identity(p)
    o = rd(p, OPT, 128)
    log['options'] = dec(o)
    (W / 'case-backup-options.bin').write_bytes(o)
    log['activeSha'] = sha(rd(p, 0x08000000, 55752))
    log['inactiveSha'] = sha(rd(p, INACT, 55752))
    log['activeLabel'] = label(log['activeSha'])
    log['inactiveLabel'] = label(log['inactiveSha'])
  time.sleep(1.5)
  log['version'] = R.restore_application(DEV, expected_version='1.2.57')

elif phase == 'swapback':
  with R.open_rom_loader(DEV) as p:
    R.require_expected_identity(p)
    o = rd(p, OPT, 128)
    log['optionsBefore'] = dec(o)
    log['activeSha'] = sha(rd(p, 0x08000000, 55752))
    log['inactiveSha'] = sha(rd(p, INACT, 55752))
    assert log['inactiveSha'] == STOCK, f"inactive is not stock ({label(log['inactiveSha'])})"
    assert log['activeSha'] != STOCK, 'active is already stock; nothing to swap'
    n = flip_swap(o)
    try:
      wmem(p, OPT, n, 8); log['optAck'] = True
    except Exception as e:
      log['optWriteErr'] = str(e)
    (W / 'case-backup-options.bin').write_bytes(n)
  time.sleep(1.5)
  log['version'] = R.restore_application(DEV, expected_version='1.2.57')
  with R.open_rom_loader(DEV) as p:
    R.require_expected_identity(p)
    o = rd(p, OPT, 128)
    (W / 'case-backup-options.bin').write_bytes(o)
    log['optionsAfter'] = dec(o)
    log['activeShaAfter'] = sha(rd(p, 0x08000000, 55752))
    log['inactiveShaAfter'] = sha(rd(p, INACT, 55752))
    log['activeLabel'] = label(log['activeShaAfter'])
    log['inactiveLabel'] = label(log['inactiveShaAfter'])
    assert log['activeShaAfter'] == STOCK, 'swapback failed: active != stock'
  time.sleep(1.5)
  log['version2'] = R.restore_application(DEV, expected_version='1.2.57')

elif phase == 'stage':
  img = CFW.read_bytes()[32:]
  assert sha(img) == V3, 'CFW image sha mismatch'
  with R.open_rom_loader(DEV) as p:
    R.require_expected_identity(p)
    o = rd(p, OPT, 128)
    d = dec(o)
    log['options'] = d
    (W / 'case-backup-options.bin').write_bytes(o)
    act = sha(rd(p, 0x08000000, 55752))
    ina = sha(rd(p, INACT, 55752))
    log['activeBefore'] = label(act); log['inactiveBefore'] = label(ina)
    assert act == STOCK, f'refuse stage: active is not stock ({label(act)}); run swapback first'
    # Never erase/overwrite stock: stock must be active alias; we only write inactive
    pages = [(128 if d['swapBank'] else 0) + i for i in range((len(img) + 0x7ff) // 0x800)]
    R.send_command(p, 0x44, 'Extended Erase')
    n = len(pages) - 1
    pl = bytes([n >> 8, n & 255]) + b''.join(bytes([q >> 8, q & 255]) for q in pages)
    x = 0
    for v in pl: x ^= v
    p.write(pl + bytes([x])); p.flush(); ack(p, 'erase', 30)
    for off in range(0, len(img), 256):
      blk = img[off:off + 256]
      blk += b'\xff' * ((-len(blk)) % 4)
      for att in range(4):
        try:
          wmem(p, INACT + off, blk); break
        except Exception as e:
          print('write issue at', hex(off), e, flush=True)
          time.sleep(.5); p.reset_input_buffer()
          try: R._resynchronize_rom_loader(p)
          except Exception as e2: print('resync', e2)
          got = rd(p, INACT + off, len(blk))
          if got == blk:
            print('block already programmed OK'); break
          if got != b'\xff' * len(blk):
            raise RuntimeError(f'partial block at {off:#x}; re-run stage')
      else:
        raise RuntimeError('write retries exhausted')
    rb = rd(p, INACT, len(img))
    log.update(pages=[pages[0], pages[-1]], srcSha=sha(img), readbackSha=sha(rb), match=rb == img)
    assert log['match'], 'readback != staged image'
    # Confirm stock still intact on active
    assert sha(rd(p, 0x08000000, 55752)) == STOCK, 'stock active corrupted during stage!'
  time.sleep(1.5)
  log['version'] = R.restore_application(DEV, expected_version='1.2.57')

elif phase == 'activate':
  img = CFW.read_bytes()[32:]
  assert sha(img) == V3
  with R.open_rom_loader(DEV) as p:
    R.require_expected_identity(p)
    o = rd(p, OPT, 128)
    log['optionsBefore'] = dec(o)
    assert rd(p, INACT, len(img)) == img, 'inactive bank is not staged v3'
    assert sha(rd(p, 0x08000000, 55752)) == STOCK, 'active must be stock before activate'
    n = flip_swap(o)
    try:
      wmem(p, OPT, n, 8); log['optAck'] = True
    except Exception as e:
      log['optWriteErr'] = str(e)
    (W / 'case-backup-options.bin').write_bytes(n)
  time.sleep(1.5)
  log['version'] = R.restore_application(DEV, expected_version='1.2.57')
  with R.open_rom_loader(DEV) as p:
    R.require_expected_identity(p)
    o = rd(p, OPT, 128)
    (W / 'case-backup-options.bin').write_bytes(o)
    log['optionsAfter'] = dec(o)
    log['activeSha'] = sha(rd(p, 0x08000000, 55752))
    log['inactiveSha'] = sha(rd(p, INACT, 55752))
    log['activeLabel'] = label(log['activeSha'])
    log['inactiveLabel'] = label(log['inactiveSha'])
    assert log['activeSha'] == V3, 'activate failed: active != v3'
    assert log['inactiveSha'] == STOCK, 'activate failed: inactive != stock'
  time.sleep(1.5)
  log['version2'] = R.restore_application(DEV, expected_version='1.2.57')

else:
  raise SystemExit(f'unknown phase {phase}')

print(json.dumps(log, indent=2))
(W / f'cfw-v3-{phase}-{int(time.time())}.json').write_text(json.dumps(log, indent=2) + '\n')
(W / f'cfw-v3-{phase}.json').write_text(json.dumps(log, indent=2) + '\n')
