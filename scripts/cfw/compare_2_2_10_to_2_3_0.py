#!/usr/bin/env python3
"""Audit the reviewed 2.2.10 CFW seams against pinned 2.3.0 stock.

Relocations are disassembly search candidates, not approved patch addresses.
This tool never builds firmware, edits a profile, or accesses a device.
"""
from __future__ import annotations
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / 'public/firmware-updates/source-files'
OLD = ARCHIVE / '2.2.10.10/5d2abaf086ad7cc4709cad679b7b24d1.bin'
NEW = ARCHIVE / '2.3.0.24/1dbdf37b03a1169c384945e94d671371.bin'
PROFILE = ROOT / 'scripts/cfw/g2-2.2.10.10-address-profile.json'
REPORT = ROOT / 'docs/firmware/2.2.10-to-2.3.0-address-comparison.json'
BASE = 0x438000


def read_at(data, address, length):
    offset = (address & ~1) - BASE
    if not 0 <= offset <= len(data) - length:
        raise ValueError(f'Address outside runtime: {address:#x}')
    return data[offset:offset + length]


def normalized(mnemonic, operands):
    if mnemonic.startswith('b') or mnemonic in ('cbz', 'cbnz'):
        operands = re.sub(r'#0x[0-9a-f]+', '#target', operands)
    if 'pc' in operands and mnemonic.startswith(('ldr', 'add', 'adr')):
        operands = re.sub(r'#[^\]]+', '#pcimm', operands)
    if mnemonic.startswith(('adr', 'movw', 'movt')):
        operands = re.sub(r'#[^,]+', '#imm', operands)
    return mnemonic + ' ' + operands


class Relocations:
    def __init__(self, old, new):
        import capstone
        dis = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB)
        dis.skipdata = True
        self.old = list(dis.disasm_lite(old, BASE))
        self.new = list(dis.disasm_lite(new, BASE))
        self.ot = [normalized(m, o) for a, s, m, o in self.old]
        self.nt = [normalized(m, o) for a, s, m, o in self.new]
        self.old_positions = {a: i for i, (a, s, m, o) in enumerate(self.old)}
        self.new_positions = {a: i for i, (a, s, m, o) in enumerate(self.new)}
        self.index = collections.defaultdict(list)
        self.cache = {}
        for i, token in enumerate(self.nt):
            self.index[token].append(i)

    def candidates(self, address):
        address &= ~1
        if address in self.cache:
            return self.cache[address]
        index = self.old_positions.get(address)
        votes = collections.defaultdict(list)
        if index is not None:
            for length in (24, 16, 10):
                for left in (0, 4, 8, 12):
                    if left >= length or index < left:
                        continue
                    seq = self.ot[index-left:index-left+length]
                    hits = [j+left for j in self.index[seq[0]] if self.nt[j:j+length] == seq]
                    if len(hits) == 1:
                        votes[hex(self.new[hits[0]][0])].append({'instructions': length, 'left': left})
        self.cache[address] = dict(votes)
        return self.cache[address]

    def literal(self, address, data, new=False):
        ins = self.new[self.new_positions[address]] if new else self.old[self.old_positions[address]]
        a, size, mnemonic, operands = ins
        if not mnemonic.startswith('ldr'):
            return None
        match = re.search(r'\[pc(?:, #(-?(?:0x[0-9a-f]+|\d+)))?\]', operands)
        if not match:
            return None
        location = ((a + 4) & ~3) + (int(match[1], 0) if match[1] else 0)
        if not BASE <= location <= BASE + len(data) - 4:
            return None
        return location, struct.unpack('<I', read_at(data, location, 4))[0]


def main():
    spec = importlib.util.spec_from_file_location('builder', ROOT / 'scripts/build_g2flash_cfw_2_2_10.py')
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    profile = json.loads(PROFILE.read_text())
    old_image, new_image = OLD.read_bytes(), NEW.read_bytes()
    sha = lambda data: hashlib.sha256(data).hexdigest()
    assert sha(old_image) == profile['baseBundleSha256']
    assert sha(new_image) == '187ccf2bcc5c17a212106e8a376745511e8289c4232b634a7ea94b9bf25a0979'
    # Validate the complete source profile on the firmware it was reviewed against.
    builder.validate_profile(profile, builder.PREVIOUS.read_bytes(), old_image)
    old, new = builder.runtime(old_image), builder.runtime(new_image)
    matcher = Relocations(old, new)
    report = {
        'oldVersion': '2.2.10.10', 'newVersion': '2.3.0.24',
        'upstreamCommit': profile['g2flashCommit'],
        'profileSha256': sha(PROFILE.read_bytes()),
        'oldSha256': sha(old_image), 'newSha256': sha(new_image),
        'baselineProfileValidated': True,
        'method': 'Exact bytes at existing addresses; relocation candidates from unique normalized Thumb windows. RAM candidates follow matched PC-relative literal loads. Candidates require independent ABI and control-flow review.',
        'components': [], 'hooks': [], 'addresses': [],
    }
    oc, nc = builder.components(old_image), builder.components(new_image)
    assert oc.keys() == nc.keys()
    for name, a in oc.items():
        b = nc[name]
        ab = old_image[a['start']:a['start']+a['size']]
        bb = new_image[b['start']:b['start']+b['size']]
        report['components'].append(dict(name=name, oldSize=len(ab), newSize=len(bb),
            oldSha256=sha(ab), newSha256=sha(bb), unchanged=ab == bb,
            oldPayloadOffset=a['start'], newPayloadOffset=b['start']))
    for hook in profile['hooks']:
        address = int(hook['newAddress'], 16)
        expected = hook['newStockBytes']
        observed = read_at(new, address, len(expected)//2).hex()
        report['hooks'].append(dict(symbol=hook['symbol'], oldAddress=hex(address),
            expected=expected, observed=observed, unchanged=expected == observed,
            relocationCandidates=(matcher.candidates(address) if hook['symbol'] not in
                ('BLE_FAST_INTERVAL_SITE', 'AUDM_PEER_SYNC_TABLE_SITE') else {})))
    for upstream, entry in profile['addresses'].items():
        address = int(entry['new'], 16)
        row = dict(upstreamAddress=upstream, oldAddress=hex(address), kind=entry.get('kind'),
                   sources=entry.get('sources', []))
        if 'newBytes' in entry:
            expected = entry['newBytes']
            observed = read_at(new, address, len(expected)//2).hex()
            row.update(expected=expected, observed=observed, unchanged=expected == observed)
            if entry.get('kind') not in ('rom-data', 'rodata-table'):
                row['relocationCandidates'] = matcher.candidates(address)
        if entry.get('loadEvidence'):
            evidence = []
            for proof in entry['loadEvidence']:
                load, literal = int(proof['newLoad'], 16), int(proof['newLiteral'], 16)
                candidates = matcher.candidates(load)
                item = dict(oldLoad=hex(load), oldLiteral=hex(literal),
                    literalAtOldLocation=hex(struct.unpack('<I', read_at(new, literal, 4))[0]),
                    instructionAtOldLocation=read_at(new, load, len(proof['newLoadBytes'])//2).hex(),
                    relocationCandidates=candidates)
                item['unchanged'] = (item['literalAtOldLocation'] == hex(address)
                    and item['instructionAtOldLocation'] == proof['newLoadBytes'])
                if len(candidates) == 1:
                    destination = int(next(iter(candidates)), 16)
                    value = matcher.literal(destination, new, new=True)
                    if value and 0x20000000 <= value[1] < 0x20800000:
                        item.update(candidateLiteral=hex(value[0]), candidateRam=hex(value[1]))
                evidence.append(item)
            row['loadEvidence'] = evidence
            row['ramCandidates'] = dict(collections.Counter(e['candidateRam'] for e in evidence if 'candidateRam' in e))
        if 'unchanged' not in row and 'loadEvidence' not in row:
            row['status'] = 'requires manual derivation; no independent byte/load signature in profile'
        report['addresses'].append(row)
    same = sum(h['unchanged'] for h in report['hooks'])
    report['summary'] = dict(reviewedAddresses=len(report['addresses']), reviewedHooks=len(report['hooks']),
        hooksUnchanged=same, hooksChanged=len(report['hooks'])-same,
        uniqueHookRelocationCandidates=sum(len(h['relocationCandidates']) == 1 for h in report['hooks']),
        cfwBuildAllowed=False,
        reason='Existing address profile is incompatible. Rebase and independently review all ROM/RAM references, ABI seams, tables, heap reservation and emitted calls before building; hardware testing remains required before publishing.')
    REPORT.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report['summary'], indent=2))
    print(REPORT)


if __name__ == '__main__':
    main()
