#!/usr/bin/env python3
"""Generate guarded Jumperless V5 route/restore scripts for G2 pad capture.

The generated MicroPython compares a fresh, exact crossbar snapshot and rail
values before making any Case-to-glasses links. Run it through the Jumperless
raw REPL only after physical wiring and meter qualification. This generator
does not access hardware itself. Software Case-to-glasses bridges are an
explicit resistive-path experiment; they cannot reproduce direct seating.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.jumperless_reset_audio_capture import validate_qualification

LINKS = {
    "left": ((22, 2), (23, 1)),
    "right": ((20, 3), (21, 4)),
}


def validate_inventory(report: dict, route: str, qualifier: dict, *, age_seconds: float) -> tuple[list, list]:
    validate_qualification(qualifier, route, datetime.now(timezone.utc))
    if age_seconds < 0 or age_seconds > 120:
        raise ValueError("Jumperless bridge snapshot must be less than two minutes old")
    if report.get("kind") != "read-only-g2-jumperless-audio-inventory":
        raise ValueError("wrong Jumperless inventory")
    if report.get("usbAudioIsEnabled") != {"available": True, "value": True}:
        raise ValueError("Jumperless USB audio is not enabled")
    audio_status = report.get("usbAudioStatus")
    if not isinstance(audio_status, dict) or audio_status.get("available") is not True or not isinstance(audio_status.get("value"), dict):
        raise ValueError("Jumperless USB audio status unavailable")
    settings = audio_status["value"]
    if settings.get("streaming"):
        raise ValueError("audio capture must be stopped while routing")
    if (settings.get("enabled") is not True or settings.get("left") != 0
            or settings.get("right") != 1 or settings.get("sample_rate") != 16000
            or settings.get("full_scale") != 8.0 or settings.get("dc_block") is not False):
        raise ValueError("Jumperless audio settings differ from qualified capture mode")
    bridges = report.get("bridges")
    rails = report.get("dacAndRailSettings")
    if not isinstance(bridges, list) or not isinstance(rails, list) or len(rails) != 4:
        raise ValueError("missing bridge or rail inventory")
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in rails):
        raise ValueError("rail readings are not numeric")
    adc0, adc1 = report.get("adc0"), report.get("adc1")
    if not all(isinstance(v, int) for v in (adc0, adc1)) or adc0 == adc1:
        raise ValueError("ADC node identity unavailable")
    if any(not isinstance(b, list) or len(b) < 2 or adc0 in b[:2] or adc1 in b[:2]
           for b in bridges):
        raise ValueError("ADC0/ADC1 must be disconnected before guarded routing")
    if any(node in {1, 2, 3, 4, 20, 21, 22, 23} for b in bridges for node in b[:2]):
        raise ValueError("Case and temple rows must be software isolated in baseline")
    return bridges, rails


def build_device_code(route: str, bridges: list, rails: list, adc0: int, adc1: int,
                      *, restore: bool, resistive_case_links: bool = False) -> str:
    pad = {"left": (2, 1), "right": (3, 4)}[route]
    additions = ([list(pair) for pair in LINKS[route]] if resistive_case_links else [])
    additions += [[adc0, pad[0]], [adc1, pad[1]]]
    expected = bridges if not restore else bridges + [[a, b, 0] for a, b in additions]
    audio_guard = '''if usb_audio_is_enabled() and usb_audio_status().get("streaming"):
    raise RuntimeError("stop audio capture before changing routes")
''' if restore else '''if not usb_audio_is_enabled():
    raise RuntimeError("USB audio is not enabled")
_audio = usb_audio_status()
if (_audio.get("enabled") is not True or _audio.get("left") != 0
        or _audio.get("right") != 1 or _audio.get("sample_rate") != 16000
        or _audio.get("full_scale") != 8.0 or _audio.get("dc_block") is not False):
    raise RuntimeError("live USB audio settings differ from capture mode")
if _audio.get("streaming"):
    raise RuntimeError("stop audio capture before changing routes")
'''
    return f'''import jumperless as j
import json
_baseline = {bridges!r}
_expected = {expected!r}
_rails = {rails!r}
_links = {additions!r}
def _routes():
    return sorted([list(j.get_bridge(i)) for i in range(j.get_num_bridges())])
def _power():
    return [j.dac_get(i) for i in range(4)]
if _routes() != sorted(_expected):
    raise RuntimeError("live Jumperless routes differ from qualified snapshot")
if _power() != _rails:
    raise RuntimeError("live Jumperless rails differ from qualified snapshot")
if j.ADC0 != {adc0!r} or j.ADC1 != {adc1!r}:
    raise RuntimeError("ADC node identity changed")
{audio_guard}_done = []
try:
    for _a, _b in {'reversed(_links)' if restore else '_links'}:
        {'j.disconnect(_a, _b)' if restore else 'j.connect(_a, _b, 0)'}
        _done.append((_a, _b))
    if _routes() != sorted({'_baseline' if restore else '_baseline + [[a, b, 0] for a, b in _links]'}):
        raise RuntimeError("route mutation did not yield exact expected bridge set")
    if _power() != _rails:
        raise RuntimeError("rail settings changed")
except Exception:
    for _a, _b in reversed(_done):
        {'j.connect(_a, _b, 0)' if restore else 'j.disconnect(_a, _b)'}
    print("G2JL_ROLLBACK=" + json.dumps({{"bridges": _routes(), "rails": _power()}}))
    raise
print("G2JL_{'RESTORED' if restore else 'ROUTED'}=" + json.dumps({{"route": {route!r}, "bridges": _routes(), "rails": _power()}}))
'''


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--route", choices=tuple(LINKS), required=True)
    parser.add_argument("--qualification", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--resistive-case-links", action="store_true",
                        help="Also connect Case to glasses through high-resistance virtual links")
    args = parser.parse_args()
    if args.output_dir.exists():
        parser.error("output directory must be fresh")
    qualifier = json.loads(args.qualification.read_text())
    report = json.loads(args.inventory.read_text())
    bridges, rails = validate_inventory(
        report, args.route, qualifier,
        age_seconds=(datetime.now(timezone.utc).timestamp() - args.inventory.stat().st_mtime),
    )
    args.output_dir.mkdir(parents=True)
    adc0, adc1 = report["adc0"], report["adc1"]
    (args.output_dir / "route-device.py").write_text(
        build_device_code(args.route, bridges, rails, adc0, adc1, restore=False,
                          resistive_case_links=args.resistive_case_links)
    )
    (args.output_dir / "restore-device.py").write_text(
        build_device_code(args.route, bridges, rails, adc0, adc1, restore=True,
                          resistive_case_links=args.resistive_case_links)
    )
    print(json.dumps({"route": args.route, "outputDir": str(args.output_dir),
                      "caseLinks": LINKS[args.route] if args.resistive_case_links else [],
                      "resistiveCasePath": args.resistive_case_links,
                      "audioAdcRows": qualifier["audioAdcRows"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
