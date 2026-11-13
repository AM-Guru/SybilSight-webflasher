"""Finite, explicitly named PB9 reset-waveform variants.

These are destructive entry experiments, not claims about the physical Apollo
reset pin. Every variant starts from the executed stock trace or from a bounded
single-low reset hypothesis and is bound into READY plus retained action proof.
"""
import struct

from case_sbl_reset_prepared.trace import fnv


WAVEFORM_CODES = {
    "stock": 0,
    "inverted-pb9": 1,
    "busy-half": 2,
    "busy-double": 3,
    "stock-double": 4,
    "low-100ms": 5,
    "low-1000ms": 6,
    "low-3000ms": 7,
}


def _summarize(base, name, actions):
    encoded = b"".join(struct.pack("<II", *action) for action in actions)
    return {
        "caseCodeSha256": base["caseCodeSha256"],
        "nativeEntry": base["nativeEntry"],
        "waveformVariant": name,
        "sourceActionFnv": base["actionFnv"],
        "sourceActionCount": len(base["actions"]),
        "actions": actions,
        "actionFnv": fnv(encoded),
        "nominalDelayTicks": sum(value for kind, value in actions if kind == 2),
        "busyIterations": sum(value for kind, value in actions if kind == 3),
        "physicalTimingMeasured": False,
        "apolloResetVerified": False,
    }


def derive(base, name):
    if name not in WAVEFORM_CODES:
        raise ValueError("unsupported PB9 waveform variant")
    stock = [tuple(action) for action in base["actions"]]
    if name == "stock":
        actions = stock
    elif name == "inverted-pb9":
        actions = [(kind, 1 - value if kind == 1 else value) for kind, value in stock]
    elif name == "busy-half":
        actions = [(kind, max(1, value // 2) if kind == 3 else value) for kind, value in stock]
    elif name == "busy-double":
        actions = [(kind, value * 2 if kind == 3 else value) for kind, value in stock]
    elif name == "stock-double":
        actions = stock + stock
    else:
        hold = {"low-100ms": 100, "low-1000ms": 1000, "low-3000ms": 3000}[name]
        actions = [(0, 1), (2, 10), (1, 1), (2, 10), (1, 0), (2, hold), (1, 1), (2, 1)]
    return _summarize(base, name, actions)
