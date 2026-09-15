#!/usr/bin/env python3
"""Independent Capstone audit of the built 2.2.10 candidate: every retargeted BL/B.W lands on
the compiled function the profile names, the trampoline literals resolve to the reviewed
2.2.10.10 stock addresses, the raw BLE edits are present, and each excluded TLSF-tail hit is a
whole memory-access instruction. Reads only build outputs; no device access."""
import hashlib, json, struct, sys
from pathlib import Path
import capstone
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import build_g2flash_cfw_2_2_10 as builder

def main(candidate_dir):
    root = Path(candidate_dir)
    manifest = json.loads((root / "manifest.json").read_text())
    img = (root / f"g2-{manifest['version']}.bin").read_bytes()
    assert hashlib.sha256(img).hexdigest() == manifest["sha256"]
    rt = builder.runtime(img)
    profile = json.loads(builder.PROFILE.read_text())
    funcs = {f["name"]: f for f in json.loads((root / "injected-functions.json").read_text())}
    cs = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB); cs.detail = True
    evidence = []
    for h in profile["hooks"]:
        if not h.get("function"):
            patched = bytes.fromhex(h["patchedBytes"]); a = int(h["newAddress"], 16)
            assert rt[a - builder.LOAD:a - builder.LOAD + len(patched)] == patched, h["symbol"]
            evidence.append({"site": hex(a), "bytes": patched.hex(), "edit": h["symbol"]}); continue
        a = int(h["newAddress"], 16) + h.get("blOffset", 0)
        ins = next(cs.disasm(rt[a - builder.LOAD:a - builder.LOAD + 4], a)); f = funcs[h["function"]]
        assert ins.mnemonic == ("b.w" if h["symbol"] == "EVENAI_ENTRY_SITE" else "bl"), (h["symbol"], ins.mnemonic)
        assert ins.operands[0].imm == int(f["address"], 16), (h["symbol"], ins.op_str, f["address"])
        evidence.append({"site": hex(a), "instruction": ins.mnemonic + " " + ins.op_str, "function": f["name"]})
    expected_literals = {"gesture_short_long": {"r0": 0x445327, "r3": 0x46900b},
                         "faceclaw_evenai_display_entry": {"ip": 0x4f79ff},
                         "headup_gate": {"r0": 0x46f71b}}
    for name, expected in expected_literals.items():
        f = funcs[name]; a = int(f["address"], 16)
        ins = list(cs.disasm(rt[a - builder.LOAD:a - builder.LOAD + f["size"]], a)); values = {}; found = {}
        for i in ins:
            if i.mnemonic in ("movw", "movt"):
                reg = i.reg_name(i.operands[0].reg); value = i.operands[1].imm
                if i.mnemonic == "movw": values[reg] = value
                else:
                    values[reg] = (values.get(reg, 0) & 0xffff) | (value << 16)
                    if reg in expected and values[reg] == expected[reg]: found[reg] = values[reg]
        for reg, value in expected.items():
            assert reg in found, (name, reg, hex(value), [(i.mnemonic, i.op_str) for i in ins])
        evidence.append({"function": name, "verifiedTrampolinePointers": {k: hex(v) for k, v in expected.items()}})
    for h in profile["tlsfTailInstructionFalsePositives"]:
        a = int(h["address"], 16); i = next(cs.disasm(rt[a - builder.LOAD:a - builder.LOAD + 4], a))
        assert i.size == 4 and i.mnemonic in ("strb.w", "ldrb.w", "ldr.w", "str.w") and i.mnemonic + " " + i.op_str == h["decoded"]
    # The short marker is emitted as immediate byte stores (see builder.capability_marker_emitted).
    assert builder.capability_marker_emitted(rt, list(funcs.values()), profile["capabilityMarker"])
    assert rt.count(b"EVENCFW/") == 0
    result = {"sha256": manifest["sha256"], "version": manifest["version"], "hookSites": len(profile["hooks"]),
              "verified": evidence, "tailInstructionExclusions": len(profile["tlsfTailInstructionFalsePositives"]),
              "capabilityMarker": profile["capabilityMarker"], "hardwareTested": False}
    (root / "emitted-code-verification.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / "work/cfw-2.2.10/candidate")
