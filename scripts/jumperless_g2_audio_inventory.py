"""DEVICE-SIDE read-only Jumperless V5 G2 capture inventory.

Run through the Jumperless raw REPL after its USB reconnect. This script
reads routes, rail settings, and USB-audio capability; it makes no bridges,
sets no voltages, and does not enable USB audio.
"""
import json
import jumperless as j


def read_optional(name):
    fn = globals().get(name)
    if fn is None:
        return {"available": False}
    try:
        return {"available": True, "value": fn()}
    except Exception as error:
        return {"available": True, "error": str(error)}


bridges = []
for index in range(j.get_num_bridges()):
    bridges.append(list(j.get_bridge(index)))

rails = []
for channel in range(4):
    try:
        rails.append(j.dac_get(channel))
    except Exception as error:
        rails.append({"error": str(error)})

report = {
    "kind": "read-only-g2-jumperless-audio-inventory",
    "bridges": bridges,
    "dacAndRailSettings": rails,
    "adc0": getattr(j, "ADC0", None),
    "adc1": getattr(j, "ADC1", None),
    "usbAudioIsEnabled": read_optional("usb_audio_is_enabled"),
    "usbAudioStatus": read_optional("usb_audio_status"),
    "usbAudioSetupAvailable": callable(globals().get("usb_audio_setup")),
    "usbAudioTeardownAvailable": callable(globals().get("usb_audio_teardown")),
}
print("G2JL_AUDIO_INVENTORY=" + json.dumps(report))
