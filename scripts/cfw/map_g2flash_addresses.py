#!/usr/bin/env python3
"""Propose 2.2.9.22 -> 2.2.10.10 mappings for every address a g2flash checkout references.

Method: unique normalized Thumb instruction windows (24/16/10 tokens, four
alignments) voted across the whole new image via a token index. RAM addresses
are mapped through matched PC-relative literal loads, never by delta. Output is
a review worksheet; nothing here is trusted until a human/disassembly review
adds it to scripts/cfw/g2-2.2.10.10-address-profile.json.
"""
from __future__ import annotations
import ast, collections, json, pickle, re, struct, sys
from pathlib import Path
import capstone

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "work/cfw-2.2.10"
BASE = 0x438000
OLD = ROOT / "public/firmware-updates/source-files/2.2.9.22/ota_s200_firmware_ota.bin"
NEW = ROOT / "public/firmware-updates/source-files/2.2.10.10/ota_s200_firmware_ota.bin"
PROFILE = ROOT / "scripts/cfw/g2-2.2.10.10-address-profile.json"
G2FLASH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Repo/g2flash"
cs = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB); cs.skipdata = True

def norm(m, o):
    if m.startswith('b') and re.search(r'#0x[0-9a-f]+', o): o = re.sub(r'#0x[0-9a-f]+', '#target', o)
    if m in ('cbz', 'cbnz'): o = re.sub(r'#0x[0-9a-f]+', '#target', o)
    if 'pc' in o and m.startswith(('ldr', 'add', 'adr')): o = re.sub(r'#[^\]]+', '#pcimm', o)
    if m.startswith(('adr', 'movw', 'movt')): o = re.sub(r'#[^,]+', '#imm', o)
    return m + ' ' + o

def load(path, tag):
    cache = WORK / (tag + '.pickle')
    if cache.exists(): return pickle.loads(cache.read_bytes())
    b = path.read_bytes()[32:]
    ins = list(cs.disasm_lite(b, BASE)); tokens = [norm(m, o) for a, s, m, o in ins]
    WORK.mkdir(parents=True, exist_ok=True); cache.write_bytes(pickle.dumps((ins, tokens))); return ins, tokens

def strip_comments(s): return re.sub(r'/\*.*?\*/|//[^\n]*', '', s, flags=re.S)

def targets():
    refs = collections.defaultdict(set); asm = {}
    for p in sorted((G2FLASH / 'patches').glob('*')):
        if p.suffix not in ('.c', '.h'): continue
        s = strip_comments(p.read_text())
        for t in re.findall(r'0x[0-9a-fA-F]{6,8}', s):
            n = int(t, 16)
            if BASE <= n < 0x800000 or 0x20000000 <= n < 0x20800000: refs[n].add(p.name)
        # inline movw/movt pairs: "movw rX, #0xLLLL" followed by "movt rX, #0xHHHH"
        for m in re.finditer(r'movw\s+(\w+),\s*#0x([0-9a-fA-F]{1,4})\\n\\t"?\s*"?\s*movt\s+\1,\s*#0x([0-9a-fA-F]{1,4})', p.read_text()):
            full = (int(m[3], 16) << 16) | int(m[2], 16)
            refs[full].add(p.name + ':asm'); asm[full] = (p.name, m[1], m[2], m[3])
    s = (G2FLASH / 'patches/patch_compress.py').read_text(); tree = ast.parse(s)
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) and 'SITE' in node.targets[0].id:
            try: v = ast.literal_eval(node.value)
            except Exception: continue
            for addr, _ in (v.items() if isinstance(v, dict) else [v]): refs[addr].add(node.targets[0].id)
    for m in re.finditer(r'\(0x([0-9a-fA-F]{6,8}), "([0-9a-f]+)", "([^"]+)"\)', s):
        refs[int(m[1], 16)].add('validate_ring_battery_stock:' + m[3])
    return refs, asm

def main():
    oi, ot = load(OLD, 'old'); ni, nt = load(NEW, 'new')
    op = {v[0]: i for i, v in enumerate(oi)}; np_ = {v[0]: i for i, v in enumerate(ni)}
    old = OLD.read_bytes()[32:]; new = NEW.read_bytes()[32:]
    positions = collections.defaultdict(list)
    for j, t in enumerate(nt): positions[t].append(j)
    profile = json.loads(PROFILE.read_text()); known = profile['addresses']
    refs, asm = targets()

    def match_idx(idx):
        votes = collections.defaultdict(list)
        for length in [24, 16, 10]:
            for left in [0, 4, 8, 12]:
                if left >= length or idx - left < 0: continue
                seq = ot[idx - left: idx - left + length]
                hits = [j + left for j in positions[seq[0]] if nt[j:j + length] == seq]
                if len(hits) == 1: votes[ni[hits[0]][0]].append([length, left])
        return votes

    def literal(ins, data):
        a, s, m, o = ins
        if not m.startswith('ldr') or '[pc' not in o: return None
        mt = re.search(r'\[pc(?:, #(-?(?:0x[0-9a-f]+|\d+)))?\]', o)
        if not mt: return None
        loc = ((a + 4) & ~3) + (int(mt[1], 0) if mt[1] else 0)
        if not BASE <= loc <= BASE + len(data) - 4: return None
        return loc, struct.unpack_from('<I', data, loc - BASE)[0]

    out = {'rom': {}, 'ram': {}, 'unresolved': [], 'alreadyKnown': [], 'asm': {}}
    for addr, sources in sorted(refs.items()):
        key = hex(addr); alt = hex(addr ^ 1)
        if key in known or (addr < 0x20000000 and alt in known):
            out['alreadyKnown'].append(key); continue
        if addr >= 0x20000000: continue
        a = addr & ~1
        if a not in op: out['unresolved'].append([key, 'not an instruction boundary in old']); continue
        idx = op[a]; votes = match_idx(idx)
        if len(votes) == 1:
            new_addr, ev = next(iter(votes.items()))
            out['rom'][key] = {'new': hex(new_addr | (addr & 1)), 'sources': sorted(sources), 'matches': ev,
                               'oldInstruction': list(oi[idx][2:]), 'newInstruction': list(ni[np_[new_addr]][2:]),
                               'oldBytes': old[a - BASE:a - BASE + 48].hex(), 'newBytes': new[new_addr - BASE:new_addr - BASE + 48].hex()}
        else:
            out['unresolved'].append([key, sorted(sources), list(oi[idx][2:]), {hex(k): v for k, v in votes.items()}])
    # RAM via literal xrefs
    rams = [k for k in refs if k >= 0x20000000 and hex(k) not in known]
    allmap = collections.defaultdict(list)
    if rams:
        for idx, ins in enumerate(oi):
            v = literal(ins, old)
            if not v or not any(0 <= r - v[1] <= 0x100 for r in rams): continue
            votes = match_idx(idx)
            if len(votes) != 1: continue
            new_addr, ev = next(iter(votes.items())); nv = literal(ni[np_[new_addr]], new)
            if not nv or not 0x20000000 <= nv[1] < 0x20800000: continue
            allmap[v[1]].append({'new': hex(nv[1]), 'oldLoad': hex(ins[0]), 'newLoad': hex(ni[np_[new_addr]][0]),
                                 'oldLiteral': hex(v[0]), 'newLiteral': hex(nv[0]), 'oldLoadBytes': old[ins[0]-BASE:ins[0]-BASE+ins[1]].hex(),
                                 'newLoadBytes': new[new_addr-BASE:new_addr-BASE+ni[np_[new_addr]][1]].hex(), 'window': ev[0]})
        for r in rams:
            direct = allmap.get(r, [])
            near = [(hex(k), r - k, dict(collections.Counter(p['new'] for p in v))) for k, v in allmap.items() if 0 < r - k <= 0x100]
            out['ram'][hex(r)] = {'sources': sorted(refs[r]), 'direct': direct, 'directVotes': dict(collections.Counter(p['new'] for p in direct)), 'near': near}
    for full, (name, reg, lo, hi) in asm.items():
        out['asm'][hex(full)] = {'file': name, 'reg': reg, 'movw': lo, 'movt': hi, 'known': hex(full) in known or hex(full ^ 1) in known}
    (WORK / 'new-matches.json').write_text(json.dumps(out, indent=1) + '\n')
    print('already known', len(out['alreadyKnown']))
    print('ROM proposals:')
    for k, v in out['rom'].items(): print(' ', k, '->', v['new'], v['sources'], v['matches'][:3], v['oldInstruction'], v['newInstruction'])
    print('RAM proposals:')
    for k, v in out['ram'].items(): print(' ', k, v['sources'], 'DIRECT', v['directVotes'], 'NEAR', v['near'][:6])
    print('ASM pairs:', json.dumps(out['asm']))
    print('UNRESOLVED:')
    for u in out['unresolved']: print(' ', u)

if __name__ == '__main__': main()
