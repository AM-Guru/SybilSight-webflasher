#!/usr/bin/env python3
"""Extend the reviewed 2.2.9.22 -> 2.2.10.10 address profile for g2flash d968c2c.

Every mapping below was produced by scripts/cfw/map_g2flash_addresses.py (unique
normalized Thumb windows, literal-load RAM evidence) and then reviewed by side-by-
side disassembly (work/cfw-2.2.10/review_sites.py). The profile stores the stock
byte signatures so build_g2flash_cfw_2_2_10.py re-verifies both images on every run.
"""
import hashlib, json, struct, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILE = ROOT / "scripts/cfw/g2-2.2.10.10-address-profile.json"
G2FLASH = Path.home() / "Repo/g2flash"
BASE = 0x438000
old = (ROOT / "public/firmware-updates/source-files/2.2.9.22/ota_s200_firmware_ota.bin").read_bytes()[32:]
new = (ROOT / "public/firmware-updates/source-files/2.2.10.10/ota_s200_firmware_ota.bin").read_bytes()[32:]
def ob(a, n): return old[(a & ~1) - BASE:(a & ~1) - BASE + n].hex()
def nb(a, n): return new[(a & ~1) - BASE:(a & ~1) - BASE + n].hex()

profile = json.loads(PROFILE.read_text())
commit = subprocess.check_output(["git", "-C", str(G2FLASH), "rev-parse", "HEAD"], text=True).strip()
assert commit == "d968c2c" or commit.startswith("d968c2c"), commit
profile["g2flashCommit"] = commit
profile["candidateVersion"] = "2.2.10.12"
profile["method"] += (" Extended for g2flash d968c2c (BLE 2M/fast-connection byte patches, head-up gate,"
                      " idle-input gate, sensor-hub compass diagnostics, R1 battery cache): the same window"
                      " matcher plus side-by-side disassembly of every new site and callee.")
profile["sourceSha256"] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                           for p in sorted((G2FLASH / "patches").iterdir()) if p.is_file() and p.suffix != ".pyc"}

A = profile["addresses"]
def rom(oldaddr, newaddr, sources, kind="rom-call", n=32, **extra):
    A[hex(oldaddr)] = dict(new=hex(newaddr), sources=sources, kind=kind, oldBytes=ob(oldaddr, n), newBytes=nb(newaddr, n), **extra)

# --- new hook sites (site bytes differ only in relocated BL displacements) ---
rom(0x4c6b30, 0x4c8c5c, ["BLE_2M_SITE"], "in-place-bytes", 16)
rom(0x7ae7b8, 0x7b2870, ["BLE_FAST_INTERVAL_SITE"], "rodata-table", 12,
    note="fast connection-parameter profile; both images carry two literal references to table-4 (see fastIntervalTableReferences)")
rom(0x47ae50, 0x47c0ec, ["BLE_FORCE_FAST_SITE"], "in-place-bytes", 2, note="_connectParamReq_impl: movs r5,r0 before bl 0x4745bc/0x475814")
rom(0x45f006, 0x45f386, ["HEADUP_GATE_BL_SITE"], "hook-site", 2, note="display-thread touch branch: bl stock idle gate; message slot stays [sp,#0xc]")
rom(0x45f01a, 0x45f39a, ["IDLE_INPUT_GATE_SITE"], "hook-site", 4, note="bl stock mode check; r4 = input record loaded from [message+8] two instructions earlier")
rom(0x4b6922, 0x4b8806, ["COMPASS_DECODE_BL_SITE"], "hook-site", 2, note="IMU parser callback: bl GAF decode with r3 = GAF buffer (0x20074af0 -> 0x20074b00 passed by register)")
rom(0x4b632e, 0x4b8212, ["COMPASS_REPORT_BL_SITE"], "hook-site", 4, note="sensor-hub emitter: bl DRV_IMUSendUIEvent(9, heading)")
# --- new ROM callees / helpers referenced from C or inline asm ---
rom(0x4448e1, 0x444909, ["gesture_fwd.c"], note="FUN_004448e0: idle path ignores head-up (OTA/onboarding)")
rom(0x45e521, 0x45e8a1, ["gesture_fwd.c"], note="FUN_0045e520: settings->head_up_switch")
rom(0x45e6e9, 0x45ea69, ["settings_ext.c"], note="FUN_0045e6e8: idle mode check")
rom(0x46f137, 0x46f71b, ["gesture_fwd.c:asm"], note="FUN_0046f136: stock idle gate (movw/movt trampoline literal)")
rom(0x47efa9, 0x480261, ["ring_battery.c"], note="dashboard ring-connected predicate")
rom(0x47eeb2, 0x48016a, ["validate_ring_battery_stock"], note="connection-bit getters")
rom(0x47efa8, 0x480260, ["validate_ring_battery_stock"], note="dashboard connection predicate")
rom(0x4a9be2, 0x4aaf16, ["validate_ring_battery_stock"], n=8, note="dashboard battery getter")
rom(0x512d84, 0x515634, ["validate_ring_battery_stock"], n=48, note="ring battery cache setter and accessors")
rom(0x4b5be5, 0x4b7ac9, ["compass.c"], note="DRV_IMUSendUIEvent")
rom(0x51c485, 0x51ed29, ["compass.c"], note="GAF decode")
rom(0x4745bd, 0x475815, ["BLE_FORCE_FAST_SITE callee"], note="connection lookup called right after the forced mode byte")
rom(0x4b2fed, 0x4b4ea5, ["ring predicate callee"], note="role query inside the dashboard ring-connected predicate")
rom(0x512da3, 0x515653, ["ring dash getter callee"], note="ring battery level accessor")
rom(0x47eebf, 0x480177, ["ring predicate callee"], note="second connection-bit getter")
# --- RAM via matched literal loads (never by delta) ---
def ram(oldaddr, newaddr, sources, proofs):
    A[hex(oldaddr)] = dict(new=hex(newaddr), sources=sources, kind="ram",
        loadEvidence=[dict(oldLoad=hex(ol), oldLiteral=hex(oi), newLoad=hex(nl), newLiteral=hex(ni),
                           oldLoadBytes=ob(ol, 4), newLoadBytes=nb(nl, 4)) for ol, oi, nl, ni in proofs])
    for ol, oi, nl, ni in proofs:
        assert struct.unpack_from("<I", old, oi - BASE)[0] == oldaddr and struct.unpack_from("<I", new, ni - BASE)[0] == newaddr, hex(oldaddr)
ram(0x200652e0, 0x200652e0, ["compass.c"], [(0x4b62e0, 0x4b6fdc, 0x4b81c4, 0x4b8ec0), (0x4b5780, 0x4b61e0, 0x4b7664, 0x4b80c4), (0x4b6cae, 0x4b6fdc, 0x4b8b92, 0x4b8ec0)])
ram(0x2007737e, 0x200773fe, ["compass.c"], [(0x4b6942, 0x4b749c, 0x4b8826, 0x4b9380)])
ram(0x20077380, 0x20077400, ["compass.c"], [(0x4b6948, 0x4b74a0, 0x4b882c, 0x4b9384), (0x4b4c72, 0x4b55cc, 0x4b6b56, 0x4b74b0)])
ram(0x2007737f, 0x200773ff, ["compass.c"], [(0x4b6952, 0x4b74a4, 0x4b8836, 0x4b9388)])
ram(0x200772a6, 0x20077314, ["ring_battery.c"], [(0x512d8e, 0x512e70, 0x51563e, 0x515720), (0x512da2, 0x512e70, 0x515652, 0x515720), (0x512dac, 0x512e70, 0x51565c, 0x515720)])
ram(0x20077406, 0x20077489, ["validate_ring_battery_stock"], [(0x47eeb2, 0x47ef1c, 0x48016a, 0x4801d4)])

# --- hooks (what build_g2flash_cfw_2_2_10.py overrides in patch_compress.py) ---
H = [h for h in profile["hooks"] if h["symbol"] != "COMPASS_EVENT_BL_SITE"]  # removed upstream in 07c0e6b
for h in H:
    if h["symbol"] == "DISPLAY_START_BL_SITES":
        h["function"] = {"0x45f146": "faceclaw_display_start", "0x45f206": "faceclaw_display_start_headup"}[h["oldAddress"]]
def hook(symbol, oldaddr, newaddr, n, **extra):
    H.append(dict(symbol=symbol, oldAddress=hex(oldaddr), newAddress=hex(newaddr), oldBytes=ob(oldaddr, n), newStockBytes=nb(newaddr, n), **extra))
hook("BLE_2M_SITE", 0x4c6b30, 0x4c8c5c, 4, patchedBytes="7d20", function=None)
hook("BLE_FAST_INTERVAL_SITE", 0x7ae7b8, 0x7b2870, 12, patchedBytes="06000600", function=None)
hook("BLE_FORCE_FAST_SITE", 0x47ae50, 0x47c0ec, 6, patchedBytes="a325", blOffset=2, function=None)
hook("HEADUP_GATE_BL_SITE", 0x45f006, 0x45f386, 4, function="headup_gate")
hook("IDLE_INPUT_GATE_SITE", 0x45f01a, 0x45f39a, 4, bl=True, function="faceclaw_idle_input_gate")
hook("COMPASS_DECODE_BL_SITE", 0x4b6922, 0x4b8806, 4, function="compass_decode_capture")
hook("COMPASS_REPORT_BL_SITE", 0x4b632e, 0x4b8212, 4, function="compass_report_event")
profile["hooks"] = H
# functions behind existing hooks, for the emitted-code verifier
for h in H:
    h.setdefault("function", {"LOADBMP_BL_SITE": "image_deferred", "SNAPSHOT_BL_SITE": "snapshot_side",
        "SETTINGS_BL_SITE": "settings_send_wrapper", "SETTINGS_DECODE_BL_SITE": "settings_decode_wrapper",
        "GESTURE_PRESS_SITE": "gesture_press", "GESTURE_SHORT_LONG_SITE": "gesture_short_long",
        "GESTURE_RELEASE_SITE": "gesture_release", "EVENAI_ENTRY_SITE": "faceclaw_evenai_display_entry",
        "DISPLAY_COPY_BL_SITES": "display_copy_hook", "WEAR_NOTIFY_BL_SITES": "faceclaw_send_wear_event"}.get(h["symbol"]))
# --- upstream ring-battery stock ABI pins, rebased (patch_compress.validate_ring_battery_stock) ---
profile["ringBatteryStockAbi"] = [
    dict(oldAddress=hex(a), newAddress=hex(b), oldBytes=ob(a, n), newBytes=nb(b, n), description=d)
    for a, b, n, d in [(0x512d84, 0x515634, 46, "cache setter and accessors"), (0x512e70, 0x515720, 4, "cache address literal"),
                       (0x47efa8, 0x480260, 46, "dashboard connection predicate"), (0x47eeb2, 0x48016a, 24, "connection-bit getters"),
                       (0x47ef1c, 0x4801d4, 4, "connection-bit address literal"), (0x4a9be2, 0x4aaf16, 8, "dashboard battery getter")]]
profile["fastIntervalTableReferences"] = dict(oldTableMinus4=hex(0x7ae7b4), newTableMinus4=hex(0x7b286c), count=2)
profile["trampolineLiterals"] = {
    "settings_ext.c": [["movw r12, #0x515b", "movw r12, #0x79ff"]],
    "gesture_fwd.c": [["movw r0, #0x4fe9", "movw r0, #0x5327"], ["movw r3, #0x8c8b", "movw r3, #0x900b"], ["movw r0, #0xf137", "movw r0, #0xf71b"]],
}
profile["capabilityMarker"] = "Faceclaw/3"
PROFILE.write_text(json.dumps(profile, indent=1) + "\n")
print("addresses", len(A), "hooks", len(H), "sources", len(profile["sourceSha256"]))
