#!/usr/bin/env python3
"""Version-gated final-copy integration for ``ble_advertised_name.c``.

Both supported stock builders populate manufacturer data from the pair serial
and then copy six BLE-MAC characters into the local-name suffix.  Redirecting
that final copy avoids the cold-start ordering bug in the earlier PSN hook,
which stock immediately overwrote with the MAC suffix.
"""

ENTRY_FUNCTION = "cfw_copy_advertised_name_pair_suffix"
DEFAULT_STOCK_VERSION = "2.2.6.10"

STOCK_PROFILES = {
    "2.2.6.10": {
        "stock_memcpy_address": 0x00439BE5,
        "final_copy_bl_site": 0x0046DDA8,
        "final_copy_bl_expected": "cb f7 1c ff",
        "serial_record_pointer_address": 0x2000383C,
        "hardware_validated": False,
    },
    "2.2.8.4": {
        "stock_memcpy_address": 0x00439BE5,
        "final_copy_bl_site": 0x0046E472,
        "final_copy_bl_expected": "cb f7 b7 fb",
        "serial_record_pointer_address": 0x20003C00,
        "hardware_validated": False,
    },
}


def stock_profile(version=DEFAULT_STOCK_VERSION):
    """Return a copy of the exact-address profile for one authenticated base."""

    try:
        return dict(STOCK_PROFILES[version])
    except KeyError as error:
        supported = ", ".join(sorted(STOCK_PROFILES))
        raise ValueError(
            f"unsupported BLE advertised-name stock version {version!r}; "
            f"supported: {supported}"
        ) from error


def compiler_defines(profile):
    """Return the C address definitions matching ``profile``."""

    return [
        (
            "-DCFW_ADV_NAME_STOCK_MEMCPY_ADDRESS="
            f"0x{profile['stock_memcpy_address']:08X}U"
        ),
        (
            "-DCFW_ADV_NAME_SERIAL_RECORD_POINTER_ADDRESS="
            f"0x{profile['serial_record_pointer_address']:08X}U"
        ),
    ]


def _function_offset(blob, name):
    for function in blob["functions"]:
        if function["name"] == name:
            return function["offset"]
    raise SystemExit(
        f"{blob.get('src', '?')}: function {name!r} not found in injected blob"
    )


def build_in_place_patches(blob, base, *, g2f, enc_bl, profile=None):
    """Return the expected-byte-gated final suffix-copy redirect."""

    selected = stock_profile() if profile is None else dict(profile)
    hook_address = base + _function_offset(blob, ENTRY_FUNCTION)
    site = selected["final_copy_bl_site"]
    return [
        (
            g2f(site),
            selected["final_copy_bl_expected"],
            enc_bl(site, hook_address),
            "bl final advertised-name suffix copy (BLE MAC -> pair serial)",
        )
    ]
