import { findTempleFlashTarget } from "./templeFlashTargets.js";

export const EVENOTA_MAGIC = new Uint8Array([
  0x45, 0x56, 0x45, 0x4e, 0x4f, 0x54, 0x41, 0x00,
]);
export const EXPECTED_COMPONENTS = [
  "firmware/codec.bin",
  "firmware/ble_em9305.bin",
  "firmware/touch.bin",
  "firmware/box.bin",
  "ota/s200_bootloader.bin",
  "ota/s200_firmware_ota.bin",
];
export const EXPECTED_COMPONENT_TYPES = [4, 5, 3, 6, 1, 0];
export const EVENOTA_TOC_TRAILER = new Uint8Array([
  0x65, 0x76, 0x65, 0x6e, 0x6f, 0x74, 0x61, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
export const APOLLO_BOOTLOADER_BASE = 0x00410000;
export const APOLLO_APPLICATION_BASE = 0x00438000;
export const APOLLO_UPDATE_FLAG_ADDRESS = 0x007fe000;
const REVIEWED_CFW_DISPLAY_CHANGES = Object.freeze([
  "Uses the full display for custom screens and images.",
  "Makes image updates smoother and more efficient.",
  "Supports different visuals on the left and right lenses.",
  "Adds richer sounds and custom alert patterns.",
  "Recognizes ring long presses and releases.",
]);
const REVIEWED_CFW_PENDING_VALIDATION =
  "Reviewed for consistency; testing on physical glasses is still pending.";
export const REVIEWED_G2FLASH_CFW_2_2_6_11 = Object.freeze({
  version: "2.2.6.11",
  reportedVersion: "2.2.6.11",
  baseVersion: "2.2.6.10",
  baseSha256: "f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa",
  sha256: "105032302d02ccf943b785070cf15877a918c120b7ca1332bb6261f70eb6d683",
  mainPayloadBytes: 3543523,
  mainPayloadSha256:
    "2d82addd4c9916781b50f7be377645b797f10856a460bc5190f3172e7161614e",
  capabilityMarker:
    "EVENCFW/8 img576 img640 imgz rle wakelease directfb fbguard wearnotify compass10",
  capabilities: [
    ...REVIEWED_CFW_DISPLAY_CHANGES,
    "Keeps custom screens active when needed, then returns to the standard Even AI experience.",
    "Keeps wear-status and compass updates available to connected apps.",
    REVIEWED_CFW_PENDING_VALIDATION,
  ],
});
export const REVIEWED_CFW = Object.freeze({
  version: "2.2.6.12",
  baseVersion: "2.2.6.10",
  baseSha256: "f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa",
  sha256: "b4de0cd3ffce5b0c756a7625b5250378d7680637e82849b15291a56a279fb4cd",
  mainPayloadBytes: 3538488,
  mainPayloadSha256:
    "81e979487d70af05fa88ae5cf1475fe183b01a14c2d8b6506585d22c0e854bcb",
  capabilityMarker: "EVENCFW/6 img576 img640 imgz rle directfb",
  capabilities: [
    ...REVIEWED_CFW_DISPLAY_CHANGES,
    REVIEWED_CFW_PENDING_VALIDATION,
  ],
});
export const REVIEWED_CFW_2_2_7_16 = Object.freeze({
  version: "2.2.7.16",
  baseVersion: "2.2.7.14",
  baseSha256: "0fced0aebcc6c88db6f76dba34f91b805d842a5fc297bfd7fa6d6a34ec83cecb",
  sha256: "6c0fdfed0eabfc40ba718ec1eec6b0728e9794a8abdb6079ebdcee2c56f58127",
  mainPayloadBytes: 3573626,
  mainPayloadSha256:
    "bdd473f5988c926e78ebc0b9d5255bbd5982957ebb24a649328d3eb92cf1c78c",
  capabilityMarker:
    "EVENCFW/6 img576 img640 imgz rle wakelease directfb fbguard",
  capabilities: [
    ...REVIEWED_CFW_DISPLAY_CHANGES,
    "Keeps custom screens active when needed, then returns to the standard Even AI experience.",
    REVIEWED_CFW_PENDING_VALIDATION,
  ],
});
export const REVIEWED_CFW_2_2_8_7 = Object.freeze({
  version: "2.2.8.7",
  baseVersion: "2.2.8.4",
  baseSha256: "df7b8bd18727765eba73be5ab836e0ee4cfd17b5e680046003b8d608d2fbfda7",
  sha256: "e9d9e8b30d5f240fb8e2fc157f552515cee4c785af6886840d420ec27e86f4e0",
  mainPayloadBytes: 3585930,
  mainPayloadSha256:
    "37a2f81a83c9f1b112c610282e784cfb8567b2b146826512b0ac3ea7d6f46901",
  capabilityMarker:
    "EVENCFW/9 img576 img640 imgz rle wakelease directfb fbguard wearnotify compass10 nameserial",
  capabilities: [
    ...REVIEWED_CFW_DISPLAY_CHANGES,
    "Keeps custom screens active when needed, then returns to the standard Even AI experience.",
    "Keeps wear-status and compass updates available to connected apps.",
    "Includes Korean system-language support from the official update.",
    REVIEWED_CFW_PENDING_VALIDATION,
  ],
});
export const REVIEWED_CFW_2_2_8_8 = Object.freeze({
  version: "2.2.8.8",
  baseVersion: "2.2.8.4",
  baseSha256: "df7b8bd18727765eba73be5ab836e0ee4cfd17b5e680046003b8d608d2fbfda7",
  sha256: "9a7ebf7b7989730ca30195af46219c188fff3c3023533b763d0ca5abf8243944",
  mainPayloadBytes: 3585266,
  mainPayloadSha256:
    "9ffd330b0dd764d1e692c2f335b9abd240228b8ab09d6de29022839ea556f477",
  capabilityMarker:
    "EVENCFW/9 img576 img640 imgz rle wakelease directfb fbguard wearnotify compass10 nameserial",
  capabilities: [
    ...REVIEWED_CFW_DISPLAY_CHANGES,
    "Keeps custom screens active when needed, then returns to the standard Even AI experience.",
    "Keeps wear-status and compass updates available to connected apps.",
    "Uses the final six pair-serial characters for both Bluetooth setup names.",
    "Includes Korean system-language support from the official update.",
    REVIEWED_CFW_PENDING_VALIDATION,
  ],
});
export const REVIEWED_CFW_2_2_8_9 = Object.freeze({
  version: "2.2.8.9",
  baseVersion: "2.2.8.4",
  baseSha256: "df7b8bd18727765eba73be5ab836e0ee4cfd17b5e680046003b8d608d2fbfda7",
  sha256: "742a0241f7ba34c6fb45c9a3ec616ba0be2b92f9c3e656b9824f6bc21a5513ca",
  mainPayloadBytes: 3585266,
  mainPayloadSha256:
    "fe834158de3ceb0770841b0f397f37be8063a1c08f40a8af7a11bfd2ffcfd7f5",
  capabilityMarker:
    "EVENCFW/9 img576 img640 imgz rle wakelease directfb fbguard wearnotify compass10 nameserial",
  capabilities: [
    ...REVIEWED_CFW_DISPLAY_CHANGES,
    "Keeps custom screens active when needed, then returns to the standard Even AI experience.",
    "Keeps wear-status and compass updates available to connected apps.",
    "Uses the final six pair-serial characters for both Bluetooth setup names.",
    "Reports the same custom firmware version from both temples.",
    "Includes Korean system-language support from the official update.",
    REVIEWED_CFW_PENDING_VALIDATION,
  ],
});
export const REVIEWED_CFW_2_2_8_10 = Object.freeze({
  version: "2.2.8.10",
  baseVersion: "2.2.8.4",
  baseSha256: "df7b8bd18727765eba73be5ab836e0ee4cfd17b5e680046003b8d608d2fbfda7",
  sha256: "3f99dcaf4c39a352402331f843f5beb7c115120f3800a7dacc568f9fe2e63e62",
  mainPayloadBytes: 3585680,
  mainPayloadSha256:
    "a16c063eccb156e2c2b219b8feb0ae128d057b80908343ff78e656aba9e54864",
  capabilityMarker:
    "EVENCFW/9 img576 img640 imgz rle wakelease directfb fbguard wearnotify compass10 nameserial",
  capabilities: [
    "Withdrawn: hardware transcripts associate this build's advertised-name hook with temples disappearing from Bluetooth discovery.",
  ],
});
export const REVIEWED_CFW_2_2_8_11 = Object.freeze({
  version: "2.2.8.11",
  reportedVersion: "2.2.8.11",
  baseVersion: "2.2.8.4",
  baseSha256: "df7b8bd18727765eba73be5ab836e0ee4cfd17b5e680046003b8d608d2fbfda7",
  sha256: "be3922f3695e0b58a6b62f40f760b6c8754488c4e9a58c96b2c13e92ef33bd3a",
  mainPayloadBytes: 3584873,
  mainPayloadSha256:
    "7423adc2b0fc2ebf9e45a1b681d3d6973823ae3432088f019a1afb48e5845691",
  capabilityMarker:
    "EVENCFW/8 img576 img640 imgz rle wakelease directfb fbguard wearnotify compass10",
  capabilities: [
    ...REVIEWED_CFW_DISPLAY_CHANGES,
    "Keeps custom screens active when needed, then returns to the standard Even AI experience.",
    "Keeps wear-status and compass updates available to connected apps.",
    "Preserves the stock Bluetooth setup and advertising behavior.",
    "Includes Korean system-language support from the official update.",
    REVIEWED_CFW_PENDING_VALIDATION,
  ],
});
export const REVIEWED_CFW_2_2_9_23 = Object.freeze({
  version: "2.2.9.23",
  reportedVersion: "2.2.9.23",
  baseVersion: "2.2.9.22",
  baseSha256: "a03fbea9f68a9de6bc271daabb9f3a41c59053d1086622c76a4e990f829cc561",
  sha256: "e5f629c6fd06ac84121022e0ecd8ef65cfebbf0c8956a0f202278451b53a0ed5",
  mainPayloadBytes: 3717475,
  mainPayloadSha256:
    "1bb7ac96c43380d766bd40ff504ec58f51ce774e18f7ac8b9d0c116df7dd8033",
  capabilityMarker:
    "EVENCFW/8 img576 img640 imgz rle wakelease directfb fbguard wearnotify compass10",
  capabilities: [
    ...REVIEWED_CFW_DISPLAY_CHANGES,
    "Keeps custom screens active when needed, then returns to the standard Even AI experience.",
    "Keeps wear-status and compass updates available to connected apps.",
    "Preserves the stock Bluetooth setup and advertising behavior.",
    REVIEWED_CFW_PENDING_VALIDATION,
  ],
});
export const REVIEWED_CFW_2_2_9_24 = Object.freeze({
  version: "2.2.9.24",
  reportedVersion: "2.2.9.24",
  baseVersion: "2.2.9.22",
  baseSha256: "a03fbea9f68a9de6bc271daabb9f3a41c59053d1086622c76a4e990f829cc561",
  sha256: "75eebde79ffe397d65980f8b03a60fefa8f8cb0c70b621ab355d6c2f90a8e445",
  mainPayloadBytes: 3731924,
  mainPayloadSha256:
    "2d492e484ebc0e3bb8763da3e8daaed34d21c104316203f7df0f65481e8f326a",
  capabilityMarker:
    "EVENCFW/15 img576 img640 imgz rle wakelease directfb fbguard wearnotify compass10 cleanup11 texcache12 teximg13 texstr14 font15",
  capabilities: [
    ...REVIEWED_CFW_DISPLAY_CHANGES,
    "Keeps custom screens active when needed, then returns to the standard Even AI experience.",
    "Keeps wear-status and compass updates available to connected apps.",
    "Provides a phone-managed 64 KiB texture cache with explicit CFW session cleanup.",
    "Draws cached images and text directly into the full-panel framebuffer.",
    "Draws UTF-8 text with the glasses' built-in 20 px font and stock kerning.",
    "Preserves the stock Bluetooth setup and advertising behavior.",
    REVIEWED_CFW_PENDING_VALIDATION,
  ],
});
export const REVIEWED_CFW_2_2_9_25 = Object.freeze({
  version: "2.2.9.25",
  reportedVersion: "2.2.9.25",
  baseVersion: "2.2.9.22",
  baseSha256: "a03fbea9f68a9de6bc271daabb9f3a41c59053d1086622c76a4e990f829cc561",
  sha256: "62c138ab9f998f4dd1affb0ebd491ae7c563e424ce6f579b5484c9995730e215",
  mainPayloadBytes: 3732003,
  mainPayloadSha256:
    "ba739c223b4cfe17105dfe632410182e6eec2adbe3a56342a3f96dfdbb97ae33",
  capabilityMarker:
    "EVENCFW/16 img576 img640 imgz rle wakelease directfb fbguard wearnotify compass10 cleanup11 texcache12 teximg13 texstr14 font15 buzzer5 diag7 multiseg8 rectcopy9 ringhold",
  capabilities: [
    ...REVIEWED_CFW_DISPLAY_CHANGES,
    "Keeps custom screens active when needed, then returns to the standard Even AI experience.",
    "Keeps wear-status and compass updates available to connected apps.",
    "Provides a phone-managed 64 KiB texture cache with atomic upload and rendering.",
    "Draws cached images and safe UTF-8 text directly into the full-panel framebuffer.",
    "Adds negotiated buzzer, diagnostic-overlay, atomic multi-operation, and scrolling controls.",
    "Preserves the stock Bluetooth setup and advertising behavior.",
    REVIEWED_CFW_PENDING_VALIDATION,
  ],
});
export const REVIEWED_CFW_2_2_9_27 = Object.freeze({
  version: "2.2.9.27",
  reportedVersion: "2.2.9.27",
  baseVersion: "2.2.9.22",
  baseSha256: "a03fbea9f68a9de6bc271daabb9f3a41c59053d1086622c76a4e990f829cc561",
  sha256: "a1e38feb3d3afa05750fe839b46964abfa2b379f9eff608816dbb7ef26061e17",
  mainPayloadBytes: 3731795,
  mainPayloadSha256:
    "ddea251a513e9275b50efea9197517eea70c148531d6c32499698ab429a01b2f",
  capabilityMarker:
    "EVENCFW/16 img576 img640 imgz rle wakelease directfb fbguard wearnotify compass10 cleanup11 texcache12 teximg13 texstr14 font15 diag7 multiseg8 rectcopy9 ringhold",
  capabilities: [
    "Uses the full 640×480 display for custom screens and images.",
    "Makes compressed and changed-region image updates more efficient.",
    "Supports different visuals on the left and right lenses.",
    "Keeps custom screens active when needed, then returns to the standard Even AI experience.",
    "Keeps wear-status and compass updates available to connected apps.",
    "Provides cached image/text rendering, diagnostic overlays, atomic multi-operation drawing, scrolling, rectangle copy, and ring-hold forwarding.",
    "Preserves the stock Bluetooth setup and advertising behavior.",
    "Withholds buzzer capability negotiation while the persistent-tone failure remains under review.",
    REVIEWED_CFW_PENDING_VALIDATION,
  ],
});
export const REVIEWED_CFW_2_2_9_28 = Object.freeze({
  version: "2.2.9.28",
  reportedVersion: "2.2.9.28",
  baseVersion: "2.2.9.22",
  baseSha256: "a03fbea9f68a9de6bc271daabb9f3a41c59053d1086622c76a4e990f829cc561",
  sha256: "dc4c4de98d183a98f8b2e98b91ab0c920b46a1ec30fcdf3d447637f2022df484",
  mainPayloadBytes: 3731795,
  mainPayloadSha256:
    "0f41679fdd38877b57e3d12f7aaddc36771fa51ecd7e118bf23dfa0eb1b47d74",
  capabilityMarker:
    "EVENCFW/16 img576 img640 imgz rle wakelease directfb fbguard wearnotify compass10 cleanup11 texcache12 teximg13 texstr14 font15 diag7 multiseg8 rectcopy9 ringhold",
  capabilities: [
    "Uses the full 640×480 display for custom screens and images.",
    "Makes compressed and changed-region image updates more efficient.",
    "Supports different visuals on the left and right lenses.",
    "Keeps custom screens active when needed, then returns to the standard Even AI experience.",
    "Keeps wear-status and compass updates available to connected apps.",
    "Provides cached image/text rendering, diagnostic overlays, atomic multi-operation drawing, scrolling, rectangle copy, and ring-hold forwarding.",
    "Preserves the stock Bluetooth setup and advertising behavior.",
    "Withholds buzzer capability negotiation while the persistent-tone failure remains under review.",
    REVIEWED_CFW_PENDING_VALIDATION,
  ],
});
export const REVIEWED_CFW_2_2_9_29 = Object.freeze({
  version: "2.2.9.29",
  reportedVersion: "2.2.9.29",
  baseVersion: "2.2.9.22",
  baseSha256: "a03fbea9f68a9de6bc271daabb9f3a41c59053d1086622c76a4e990f829cc561",
  sha256: "960b964f2dfdfb17edf222f0ec3c5c44ca9ee502fe2a9873919e951a6c158ac5",
  mainPayloadBytes: 3736231,
  mainPayloadSha256:
    "a7f170a7e3870cfc8ce642ac3b05e6bec7fb02b2ae75231afac244a093e6adf6",
  capabilityMarker:
    "EVENCFW/17 img576 img640 imgz rle wakelease directfb fbguard wearnotify compass10 cleanup11 texcache12 teximg13 texstr14 font15 diag7 multiseg8 rectcopy9 ringhold micctl micmc micraw",
  capabilities: [
    "Uses the full 640×480 display for custom screens and images.",
    "Makes compressed and changed-region image updates more efficient.",
    "Supports different visuals on the left and right lenses.",
    "Keeps custom screens active when needed, then returns to the standard Even AI experience.",
    "Keeps wear-status and compass updates available to connected apps.",
    "Provides cached image/text rendering, diagnostic overlays, atomic multi-operation drawing, scrolling, rectangle copy, and ring-hold forwarding.",
    "Adds microphone configuration, multichannel, and raw-frame protocols; hardware capture remains disarmed until explicitly requested.",
    "Preserves the stock Bluetooth setup and advertising behavior.",
    "Withholds buzzer capability negotiation while the persistent-tone failure remains under review.",
    REVIEWED_CFW_PENDING_VALIDATION,
  ],
});
export const REVIEWED_CFW_2_2_9_43 = Object.freeze({
  version: "2.2.9.43",
  reportedVersion: "2.2.9.43",
  baseVersion: "2.2.9.22",
  baseSha256: "a03fbea9f68a9de6bc271daabb9f3a41c59053d1086622c76a4e990f829cc561",
  sha256: "0ad7a4ac3aab591ba32e49b2d2834a9d15b147446d854febc994fda232842ebe",
  mainPayloadBytes: 3738235,
  mainPayloadSha256:
    "528ef8d9c16beb899df2a14ed6c8a3d0d27f226f01b37e1a293e573831f13fd2",
  capabilityMarker:
    "EVENCFW/31 img576 img640 imgz rle wakelease directfb fbguard wearnotify compass10 cleanup11 texcache12 teximg13 texstr14 font15 diag7 multiseg8 rectcopy9 ringhold micctl micmc micraw",
  capabilities: [
    ...REVIEWED_CFW_2_2_9_29.capabilities,
  ],
});
export const REVIEWED_CFW_2_2_10_12 = Object.freeze({
  version: "2.2.10.12",
  reportedVersion: "2.2.10.12",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "83fc2ea805ba67b324f02c260904f518d997edae6051724b366fa477ec7b7616",
  mainPayloadBytes: 3754816,
  mainPayloadSha256: "a795d3f847a6b3e17ff5a40059c572bcb0ccf600b1e1a6a36728c4bde4d3adfa",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3).",
    "Enables LE 2M PHY and forces the 7.5 ms fast connection profile so the stock 60 s slow-mode timer cannot throttle transfers.",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_13 = Object.freeze({
  version: "2.2.10.13",
  reportedVersion: "2.2.10.13",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "1ad820c2b1e58827e55a4cad86b818cad4539b01bd379900261d6c5585b25b34",
  mainPayloadBytes: 3754800,
  mainPayloadSha256: "8f33c0092a696499098f68ce314c6b96da8741cc99ba95489d345681a56a0c3e",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with a reviewed overlay of mic_control.c.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle); upstream's argument orders left the tap unregistered and faulted the temples when armed.",
    "Enables LE 2M PHY and forces the 7.5 ms fast connection profile so the stock 60 s slow-mode timer cannot throttle transfers.",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_14 = Object.freeze({
  version: "2.2.10.14",
  reportedVersion: "2.2.10.14",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "56be9c28cad2664ce0196822921d9a48135ddeed5731ffbf2aa4d19b10e60b48",
  mainPayloadBytes: 3755302,
  mainPayloadSha256: "704add9ac9ea40f1c070342aca027ff07311b1d23c3419e0d2d6a77ea7a2a6a2",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with a reviewed overlay of mic_control.c.",
    "Streams the four-microphone array as packet-independent IMA ADPCM at 8 kHz (one BLE notification per frame) instead of raw PCM; fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle); upstream's argument orders left the tap unregistered and faulted the temples when armed.",
    "Enables LE 2M PHY and forces the 7.5 ms fast connection profile so the stock 60 s slow-mode timer cannot throttle transfers.",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_15 = Object.freeze({
  version: "2.2.10.15",
  reportedVersion: "2.2.10.15",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "987d4e09b57e2d99c4d25da141e8a9934a1344ac840dbd11bbac1c8188b4618f",
  mainPayloadBytes: 3755046,
  mainPayloadSha256: "13073f782f706ae3e2439ccd141be4ad7b7e2270d4090b20b0c35a59f3547bfe",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with a reviewed overlay of mic_control.c.",
    "Streams the four-microphone array as packet-independent IMA ADPCM at the full 16 kHz capture rate when the phone requests rate 160 (227-byte frames, one BLE notification each at MTU 247); rate requests below 160 keep the 8 kHz decimated form. Field-104 status advertises the payload rate.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Enables LE 2M PHY and forces the 7.5 ms fast connection profile so the stock 60 s slow-mode timer cannot throttle transfers.",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_16 = Object.freeze({
  version: "2.2.10.16",
  reportedVersion: "2.2.10.16",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "a3e51afd44dedd124b46b214eee6c35c4d12dc644d474cab6e05dc3e9d8bf470",
  mainPayloadBytes: 3755250,
  mainPayloadSha256: "166b0409a498a82e4dd5d776447b05cdc430533d89e88ead576dee0fd7480a97",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with a reviewed overlay of mic_control.c.",
    "Streams the four-microphone array as packet-independent IMA ADPCM and slices each ~50 ms capture chunk into as many 200-sample frames as it needs (two at 8 kHz stereo, four at 16 kHz stereo) instead of truncating it; frame flags carry the slice index (bits 4-5), a more-slices bit (3), and the producing temple (bit 6 = left).",
    "Honours a 16 kHz rate request with undecimated coding; requests below 160 keep the 8 kHz decimated form. Field-104 status advertises the payload rate.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Enables LE 2M PHY and forces the 7.5 ms fast connection profile so the stock 60 s slow-mode timer cannot throttle transfers.",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_17 = Object.freeze({
  version: "2.2.10.17",
  reportedVersion: "2.2.10.17",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "6be18b390d1a807e34e8d7e531abf8fb04914831ebe594435d16d0515e87fd9f",
  mainPayloadBytes: 3755426,
  mainPayloadSha256: "bbb60e2d6ddd4f32f47b397de997812e3bfecdd6056c217c91ed2bd5866fd3d4",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with a reviewed overlay of mic_control.c.",
    "The left temple mirrors its field-104 microphone-array status on the streaming-notify path, because the stock protobuf transmit path drops every settings notification on the left temple; the phone attributes the mirrored record to the left link.",
    "Streams the four-microphone array as packet-independent IMA ADPCM, slicing each ~50 ms capture chunk into 200-sample frames (slice index, more-slices and producing-side bits in the frame flags); honours a 16 kHz rate request with undecimated coding.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Enables LE 2M PHY and forces the 7.5 ms fast connection profile so the stock 60 s slow-mode timer cannot throttle transfers.",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_18 = Object.freeze({
  version: "2.2.10.18",
  reportedVersion: "2.2.10.18",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "a020741f22a74eb1fa91f2b3caa4e9a2b797a8ed48732f7cc1b735510001b96d",
  mainPayloadBytes: 3755878,
  mainPayloadSha256: "8a6ab7ba9a2a5ad5cd97b0bdec436c456f8139f5d01e18d3351295705cb7bd6b",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with a reviewed overlay of mic_control.c.",
    "Opt-in (CONFIGURE flag bit2) audio-manager arming: takes PCM slot 0, holds audio-manager app slot 7 on the left temple, and opens the codec through thread.audio's own codec-control primitive instead of the production-test wrappers; clears the one-shot codec audio-check flag once frames flow so a stale-frame window cannot reboot the codec under the stream; stops only when no stock app holds the codec.",
    "Both temples mirror their field-104 status on the streaming-notify path with codec-driver state cells appended (fresh DMA frames, codec-on, I2S init, codec power, audio sync, app-slot bitmask, producing side).",
    "Streams the four-microphone array as packet-independent IMA ADPCM, slicing each ~50 ms capture chunk into 200-sample frames (slice index, more-slices and producing-side bits in the frame flags); honours a 16 kHz rate request with undecimated coding.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Enables LE 2M PHY and forces the 7.5 ms fast connection profile so the stock 60 s slow-mode timer cannot throttle transfers.",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_19 = Object.freeze({
  version: "2.2.10.19",
  reportedVersion: "2.2.10.19",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "1171f03fd1799573e79ac7da0a72d08cf6caf69ec65dea421e432de6c156dcfc",
  mainPayloadBytes: 3755998,
  mainPayloadSha256: "9a6f96ddf8a3317993f390ca0608ba24b1dcf65a56cd49e5fbd6c9af7052ae5c",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Fast connection profile is 11.25-15 ms (Apple-acceptable) instead of upstream's 7.5 ms, which CoreBluetooth rejects and the firmware never falls back from; the slow-mode suppression and the LE 2M local-feature bit are unchanged.",
    "Both temples report the granted phone-link connection parameters (interval, latency, supervision timeout, profile mode) on the streaming-notify path as an 'ML' record alongside the mirrored microphone-array status.",
    "Opt-in (CONFIGURE flag bit2) audio-manager arming with codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_20 = Object.freeze({
  version: "2.2.10.20",
  reportedVersion: "2.2.10.20",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "7bb87ac9d1182f5ffeb15382db4b6ce701711f1c1858a5ebd527887be29802db",
  mainPayloadBytes: 3755958,
  mainPayloadSha256: "9d70240009d4165f8ebf946aec779faf460ab90ba61e87916b6b2149895dddc0",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Audio-manager arming (CONFIGURE flag bit2) no longer writes the audio-manager app table; a stock release that powers the codec down under the armed tap is repaired on the next lease RENEW instead.",
    "Fast connection profile 11.25-15 ms (Apple-acceptable); both temples report the granted phone-link connection parameters as an 'ML' record on the streaming-notify path; codec-driver state diagnostics in the mirrored status; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_21 = Object.freeze({
  version: "2.2.10.21",
  reportedVersion: "2.2.10.21",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "0622ac8249b37ae28d2a3f301b604f7eba3d241ff3fad68d84987feaab7f3a55",
  mainPayloadBytes: 3755958,
  mainPayloadSha256: "e10dd49b74cac88d37023d0432acccd9e79b0ad16706cf4717396f5ad4ad6a5f",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Fast connection profile kept at stock 15/30 ms: Apple centrals require interval min >= 15 ms (a multiple of 15) and max >= min + 15 ms, so upstream's 7.5 ms and the 11.25-15 ms attempt were both rejected and the link stayed at the Mac's 30 ms default (measured via the 'ML' record on 2.2.10.20). Slow-mode suppression and the LE 2M feature bit unchanged.",
    "Both temples report the granted phone-link connection parameters as an 'ML' record; manager arming without the app-table hold; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_22 = Object.freeze({
  version: "2.2.10.22",
  reportedVersion: "2.2.10.22",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "628b2a7f2a25b72dd0d21b26592e7ec552b1275148e4d1c2285f1234c3e85575",
  mainPayloadBytes: 3755958,
  mainPayloadSha256: "24f71c9380b4b200baf6c2b496859e48ad7fd11f0bf2f29be746098662674317",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Fast connection profile min = max = 15 ms, the exact form Apple centrals accept below their 30 ms default (a 15-30 ms range left the default in force; 7.5 ms and 11.25-15 ms were rejected). Slow-mode suppression and the LE 2M feature bit unchanged.",
    "Both temples report the granted phone-link connection parameters as an 'ML' record; manager arming without the app-table hold; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_23 = Object.freeze({
  version: "2.2.10.23",
  reportedVersion: "2.2.10.23",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "a16f0ca1159fbfcac9f5ce1d4818c46003671a01043a52c3bcb5c8b8df2773e3",
  mainPayloadBytes: 3756022,
  mainPayloadSha256: "5c576a267af9a74237b8d1b3c5b10880755ca7126ed4d9d7502806ce679608fc",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Fast connection profile min = max = 15 ms; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_24 = Object.freeze({
  version: "2.2.10.24",
  reportedVersion: "2.2.10.24",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "630ef16fea23116e8cf26a3b77be104bc6480ae0164641d26085997587acda20",
  mainPayloadBytes: 3756090,
  mainPayloadSha256: "925b29cd0952bb44543516fbb613c059beb215587776d0bdda26601e46800bb3",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile min = max = 15 ms; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_25 = Object.freeze({
  version: "2.2.10.25",
  reportedVersion: "2.2.10.25",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "e924f0f253e8459365287fc1585aa3a731459c0d8c0e2a952bf2a7747c912d22",
  mainPayloadBytes: 3756186,
  mainPayloadSha256: "90a750ed7c001583f13396d3bd464fb57803447297093cc416fc202e116a4bca",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile min = max = 15 ms; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_26 = Object.freeze({
  version: "2.2.10.26",
  reportedVersion: "2.2.10.26",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "ee0d9016f4d6894e9561379b7e0a6b8a0ab6eb8f75c86263bbdb3cd0d7c29205",
  mainPayloadBytes: 3756254,
  mainPayloadSha256: "b8d0317859b3f45e4c70c6601c163f3d9104f85f85ed20b121d518fb303c0d56",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_27 = Object.freeze({
  version: "2.2.10.27",
  reportedVersion: "2.2.10.27",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "43cd3f48a0580001a38222eabdd3a546a0451d41cc05431010e980566fb3b4c4",
  mainPayloadBytes: 3756270,
  mainPayloadSha256: "d9cf331b0d23d76de572d1248887d4d949817be5d09869e3e57ad5f4bf35c37b",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_28 = Object.freeze({
  version: "2.2.10.28",
  reportedVersion: "2.2.10.28",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "dedc0c56da3d07f1d5ea623af1217348078e2f43231d4b1bfd4cba1acc78f731",
  mainPayloadBytes: 3756254,
  mainPayloadSha256: "564a1716ad08aca367d39af4fb1a6e2a750159813a6975775dd83d495fa9dc6a",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_29 = Object.freeze({
  version: "2.2.10.29",
  reportedVersion: "2.2.10.29",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "9bb24bd840d0dcb2909917b19f100db27dc5456c5c6c742bf78869ef3e8fa650",
  mainPayloadBytes: 3756282,
  mainPayloadSha256: "6349bffa1e411a36a03b70c353fabee9830f427ed38e721fc9db9d8f5552d675",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_30 = Object.freeze({
  version: "2.2.10.30",
  reportedVersion: "2.2.10.30",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "dfc9d4e16c65527841ad594e9fd6aeacbb0296f9411c3605b46dbd051e771708",
  mainPayloadBytes: 3756358,
  mainPayloadSha256: "d2a50a366b635c0737dce627e33b178dc14e9ba2db86884da45e84ac7e873a01",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_31 = Object.freeze({
  version: "2.2.10.31",
  reportedVersion: "2.2.10.31",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "3fec074f6dd20c5a526eb5bbb958c5bab6fa0b1bc58b205e6a79461c0f92dde0",
  mainPayloadBytes: 3756334,
  mainPayloadSha256: "78edfdd3bc69be2a550d3ebafb0938a3778188244a8d234f79aecd0485e8badb",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_32 = Object.freeze({
  version: "2.2.10.32",
  reportedVersion: "2.2.10.32",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "0c84518cc9110120c4445237b8979a95756e89f7a7ac415e0f9f6ab8cd40bd9c",
  mainPayloadBytes: 3756270,
  mainPayloadSha256: "506274b23e08c224031ef98aeb553f786cc59ca0dcd32bbe757664370cce4cf6",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_33 = Object.freeze({
  version: "2.2.10.33",
  reportedVersion: "2.2.10.33",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "e592ec1197122f32e96e182968194de6f41a12b11066e986e383ae59d13aaea7",
  mainPayloadBytes: 3756290,
  mainPayloadSha256: "e813e3588c0d69cd2b19d6674f002d55e248a38ca063136fabeab645aaf56e15",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Reboots the GX8002 codec only on the right temple (the wedged one), gives the left a plain bring-up, and arms right-first so the left arms last and reopens its own DMIC — a codec reboot fires an inter-temple sync that closes the other temple's DMIC, so rebooting both broke one side.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_34 = Object.freeze({
  version: "2.2.10.34",
  reportedVersion: "2.2.10.34",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "77830d5bc34ca50c3b91fd5bffa27fad01a469789fc8d8de2cb8024b87d7f9b3",
  mainPayloadBytes: 3756262,
  mainPayloadSha256: "0256c8f3792c8a507ed4e1820bf138f4b4bfe5fe8e78162db4d12b7b4ad69241",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Plain codec bring-up on both temples with no GX8002 reboot in the steady-state arm path — once un-wedged the codec chip stays clean across host soft reboots, and a wedged codec is recovered out of band rather than by a link-disrupting reboot on every arm.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_35 = Object.freeze({
  version: "2.2.10.35",
  reportedVersion: "2.2.10.35",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "c2f7cb3bb3c123866568c82b7555c7f4dd218b4b489fb81f42d60523ecd70f04",
  mainPayloadBytes: 3756286,
  mainPayloadSha256: "184c8082f2b057e16e9f65725916572939c3830960b1c2be82b9d066a47ef46c",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_36 = Object.freeze({
  version: "2.2.10.36",
  reportedVersion: "2.2.10.36",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "ef142794881a0a943b508d6635d3006baaa643bf732e3ab6896f6fa63192c258",
  mainPayloadBytes: 3758618,
  mainPayloadSha256: "4a061a79cbaad3cf90297605483e45133b588c554809430c95c9fbdea88b1c24",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "After the one-shot power-cycle the codec is left running undisturbed (no tap) for a 10 s settle window so its post-power-on MicDelay calibration completes, and only then is the bring-up finished and the tap registered — tapping during calibration broke it and left the stream noisy.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_37 = Object.freeze({
  version: "2.2.10.37",
  reportedVersion: "2.2.10.37",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "c27c27088f7bbef2b2e80b3ae18f19323665b57943168b2e07feeda689356a83",
  mainPayloadBytes: 3758318,
  mainPayloadSha256: "538bb537fe5e30dbc67e96ddae50bf22fdaeab8efa137131c4033b1187339a59",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_38 = Object.freeze({
  version: "2.2.10.38",
  reportedVersion: "2.2.10.38",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "ec8f6a5c279243087f7a79ebb0d7789667f255472ab05bc2f6a078356492254d",
  mainPayloadBytes: 3759106,
  mainPayloadSha256: "36e6192e0a5772a6a19a25d9621ebd749961890c64493535a4de125831d61434",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_39 = Object.freeze({
  version: "2.2.10.39",
  reportedVersion: "2.2.10.39",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "7c01ddc9bee3cd0bff2b433d5a184506b9cc8f9723bdc90f1ca7823e1e05b919",
  mainPayloadBytes: 3759118,
  mainPayloadSha256: "a40d40f979deb48ea5c08b61da77f5f522d04ccb6fd41870aa196a3d334f1d42",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_40 = Object.freeze({
  version: "2.2.10.40",
  reportedVersion: "2.2.10.40",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "cc3ce0ff0560614ff918bd0abe94c12f2f9b8c07fb34110cbcc8459f44c334c6",
  mainPayloadBytes: 3759174,
  mainPayloadSha256: "69924cab10ce79079535524159c10f3e408229d5272f4e21563de0c216de37e3",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Only the right temple power-cycles its codec; the left, whose own reboot left it silent, does a plain bring-up deferred until the right's cycle and the inter-temple codec sync that re-initialises the left have run — the arrangement that produced a fully clean left temple.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_41 = Object.freeze({
  version: "2.2.10.41",
  reportedVersion: "2.2.10.41",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "cbb6715f63159dbbff69957b87424e11a36ca4882d4c355316c38334a03849aa",
  mainPayloadBytes: 3759238,
  mainPayloadSha256: "def8b3af5137479a1617c79028b466bf66d29c9ecc0ef4aca7e378ce7d9eb066",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "The right temple's codec power-cycle is sequenced non-blockingly from the CFW timer — power off, 100 ms, power on, ~8 s chip boot, then a single I2S init on the booted chip — instead of the stock reboot op, whose immediate I2S init locked to garbage and whose codec transactions against the still-booting chip were the sometimes-long block that intermittently dropped the BLE link.",
    "Only the right temple power-cycles its codec; the left, whose own reboot left it silent, does a plain bring-up deferred until the right's cycle and the inter-temple codec sync that re-initialises the left have run — the arrangement that produced a fully clean left temple.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_42 = Object.freeze({
  version: "2.2.10.42",
  reportedVersion: "2.2.10.42",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "173468ba6513023c5280a4477834eb0809bcc96e4a045bb00fed80db8f29c089",
  mainPayloadBytes: 3759294,
  mainPayloadSha256: "e59c9a9f7305b33a151b1ff05f8a1549330a30a3124bedb854d69f0722cea7fd",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Resets the right temple's GX8002 through its own enable/reset lines (Apollo GPIO 143 and 146) only and never releases logical pin 6 — which is not a GPIO but a shared-regulator enable (GPIO 134) that the codec driver's power-off drops, browning out the EM9305 radio path and timing the BLE link out 772 ms later — so the codec gets a hard reset while the link stays up.",
    "Legacy: the right temple's codec power-cycle is sequenced non-blockingly from the CFW timer — power off, 100 ms, power on, ~8 s chip boot, then a single I2S init on the booted chip — instead of the stock reboot op, whose immediate I2S init locked to garbage and whose codec transactions against the still-booting chip were the sometimes-long block that intermittently dropped the BLE link.",
    "Only the right temple power-cycles its codec; the left, whose own reboot left it silent, does a plain bring-up deferred until the right's cycle and the inter-temple codec sync that re-initialises the left have run — the arrangement that produced a fully clean left temple.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_43 = Object.freeze({
  version: "2.2.10.43",
  reportedVersion: "2.2.10.43",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "b1465f65b2348f80bdf92cfefe40284da2b727f08d8688b41b47127388f4eaf9",
  mainPayloadBytes: 3759266,
  mainPayloadSha256: "b0edef701c158f55e6d62e77adb09b5bfa9382f6a06db4cce133250f3fa72b43",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples reset their own GX8002 through its enable/reset lines (GPIO 143/146, rail untouched) at the same time: a reset on one temple fires the inter-temple audio sync handshake, which ties that temple up past the link supervision when the other temple is healthy but aborts at once when both are mid-reset — resets on both temples together never dropped a link.",
    "Legacy: resets the right temple's GX8002 through its own enable/reset lines (Apollo GPIO 143 and 146) only and never releases logical pin 6 — which is not a GPIO but a shared-regulator enable (GPIO 134) that the codec driver's power-off drops, browning out the EM9305 radio path and timing the BLE link out 772 ms later — so the codec gets a hard reset while the link stays up.",
    "Legacy: the right temple's codec power-cycle is sequenced non-blockingly from the CFW timer — power off, 100 ms, power on, ~8 s chip boot, then a single I2S init on the booted chip — instead of the stock reboot op, whose immediate I2S init locked to garbage and whose codec transactions against the still-booting chip were the sometimes-long block that intermittently dropped the BLE link.",
    "Only the right temple power-cycles its codec; the left, whose own reboot left it silent, does a plain bring-up deferred until the right's cycle and the inter-temple codec sync that re-initialises the left have run — the arrangement that produced a fully clean left temple.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_44 = Object.freeze({
  version: "2.2.10.44",
  reportedVersion: "2.2.10.44",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "de4b99e45b1894906a2b97c7da4ff991b4fad34ee52c25e5b32d82a2f4f9aa31",
  mainPayloadBytes: 3759162,
  mainPayloadSha256: "355d46c7449929827c9fea8d1240c6af660b97ad08a035ef571f8637e07a6307",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_45 = Object.freeze({
  version: "2.2.10.45",
  reportedVersion: "2.2.10.45",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "f7bf4ceede25008bad349c21ffe5346a4c2bd3d6a6f6be5940fc8f30e4460f80",
  mainPayloadBytes: 3754158,
  mainPayloadSha256: "8c816854058dd5571d3828f2ff356f9f2f70d4f519c4397f97671c6a145d17d4",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_46 = Object.freeze({
  version: "2.2.10.46",
  reportedVersion: "2.2.10.46",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "914c380fb66e6479c6b237899c032db9697a8f9892ca99a0143b14a89b391b76",
  mainPayloadBytes: 3754258,
  mainPayloadSha256: "9cb0b0e019fffddc695d002e70e4aa223070143d4557084148dd6faabfd4d479",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_47 = Object.freeze({
  version: "2.2.10.47",
  reportedVersion: "2.2.10.47",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "75f829864b9c92ecfdb08cd48c3769e698fab3dae6259e3f72beb214a6a592a9",
  mainPayloadBytes: 3758038,
  mainPayloadSha256: "368562728e17cf00c50701a3fa294420b4487a24d72f224384647fa677bbbdc5",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_48 = Object.freeze({
  version: "2.2.10.48",
  reportedVersion: "2.2.10.48",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "a1c4bd9519f6195abc43e9d5ba790695efece8ad52d8eb2f8638598ee26e69cc",
  mainPayloadBytes: 3759394,
  mainPayloadSha256: "b373626ddc53c1b1e1267cd2028bcbc1983f3f17159d6ca3661ce1ba0e2bad0d",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_49 = Object.freeze({
  version: "2.2.10.49",
  reportedVersion: "2.2.10.49",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "9b42dca9cf7af48297ebcd68eeebbb9a8fb1afe80517bef5b5f8b1aafb211627",
  mainPayloadBytes: 3754946,
  mainPayloadSha256: "364d311f9fc75ce196914134e299220f472b68fd47875a0706dd8dc749453ae2",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_50 = Object.freeze({
  version: "2.2.10.50",
  reportedVersion: "2.2.10.50",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "d95eb16c82621d18762b1889a0b74a1020aa238bcf600743db5d172cd0309dfa",
  mainPayloadBytes: 3758222,
  mainPayloadSha256: "d91aafc1fb4ede80d32e6c7b26be3ed9a873df652af873e1bf3f31d3c2683f75",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_51 = Object.freeze({
  version: "2.2.10.51",
  reportedVersion: "2.2.10.51",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "79f170312a4de81f7c153a437471d4e658610e5c552724e45a54f29101806fcb",
  mainPayloadBytes: 3759874,
  mainPayloadSha256: "c2e8efdafe833b31fd05b6bb067ce0f3ed3afbc716dfdbeeb09bf082d445f43b",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_52 = Object.freeze({
  version: "2.2.10.52",
  reportedVersion: "2.2.10.52",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "84e86d8fd9eaf4e75c6baa3443d54f17657c53da7bb2d5fa1db74677134aeb5d",
  mainPayloadBytes: 3755298,
  mainPayloadSha256: "3e00c6e025e1e4bf12cc28c8c292c6fa1371579d1f61435c9230379e4d0ca3a7",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_53 = Object.freeze({
  version: "2.2.10.53",
  reportedVersion: "2.2.10.53",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "4b015f9d4e4edaa923254d0ddae6ce35a4a14e98479c19b27af5936d62394680",
  mainPayloadBytes: 3755282,
  mainPayloadSha256: "d6252b8688429012e9103bef79a4df59cdc3430b43710780eead7c9054b21a18",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_54 = Object.freeze({
  version: "2.2.10.54",
  reportedVersion: "2.2.10.54",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "607ce31887443592caf944af373489838db844d4dd3a1511cb6b19eee1ad0ac3",
  mainPayloadBytes: 3760238,
  mainPayloadSha256: "29250699d77f489a7918073b19146e07a59ca181c2e118ce4659705bc22bec29",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_55 = Object.freeze({
  version: "2.2.10.55",
  reportedVersion: "2.2.10.55",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "1c10d3d0cc03bc0a072fb27990198455e9e2a3514f74d486a2dbd38203b8ab80",
  mainPayloadBytes: 3760018,
  mainPayloadSha256: "ecdc5e1b030f4afd100203df41bdeb397023767838ad2ed2cd8a16955b24851d",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_56 = Object.freeze({
  version: "2.2.10.56",
  reportedVersion: "2.2.10.56",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "47d8b6198e8eea588a348cd94cc497e3684439134484f001c7f1ec6b630c304a",
  mainPayloadBytes: 3755530,
  mainPayloadSha256: "8ef804d16e6ff475b4518bb37c05c0a7eab5c2af1bc76e896c0298d72b61c242",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_57 = Object.freeze({
  version: "2.2.10.57",
  reportedVersion: "2.2.10.57",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "7410bc38e837b3494e246a24d42caba3d105080e76b39841e605b3a623ec2855",
  mainPayloadBytes: 3755414,
  mainPayloadSha256: "87dd075a822e083a96ee63c3bef6a79fe609108559deedfa06594551159a12d1",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_58 = Object.freeze({
  version: "2.2.10.58",
  reportedVersion: "2.2.10.58",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "e6cb4a84935d83c9ec45bf8a277decb32f5007330fec7989ac1351e670465031",
  mainPayloadBytes: 3755286,
  mainPayloadSha256: "cace81f93bd141ee8899ed9a473bf49b35d28bf4d7463e36435b92b5890c9a6b",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_59 = Object.freeze({
  version: "2.2.10.59",
  reportedVersion: "2.2.10.59",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "72d02a1898f6c40573b4098fdf38c22ce9e516da0d9812424fc9207a130f3e5b",
  mainPayloadBytes: 3755534,
  mainPayloadSha256: "0fd106ab773737ea6ee1e430854ea653731714731aa6b80429ed9173c9fd4240",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_60 = Object.freeze({
  version: "2.2.10.60",
  reportedVersion: "2.2.10.60",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "a89c2fe68b4b9e1bb45b0a75dca2e2e9399300a9824c360070380407c9d652bb",
  mainPayloadBytes: 3755806,
  mainPayloadSha256: "f5557abc7f52d9426ab41f053ddb98316e3ee3825f2f80b6a14240da069684b5",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_61 = Object.freeze({
  version: "2.2.10.61",
  reportedVersion: "2.2.10.61",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "6de1e1ec20d4c5461707a0e448e6a823c05d20fa5295376e9bc67b1b1397f309",
  mainPayloadBytes: 3759446,
  mainPayloadSha256: "b4bfad3c2d018949f9b5d3ae47562cdc43605324ad8b93cb66c3b014cef9e8b4",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_62 = Object.freeze({
  version: "2.2.10.62",
  reportedVersion: "2.2.10.62",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "4f0ee75ec16088bec51f8c996395f01efcf9cf6cef0a3af7f54b3e0ff96c2559",
  mainPayloadBytes: 3762762,
  mainPayloadSha256: "364febc71251d0c294cbd55b0199a991877f3a466cfc137ac69e81e41076c2a9",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_63 = Object.freeze({
  version: "2.2.10.63",
  reportedVersion: "2.2.10.63",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "4952e63be016add86f17c5a52a00e4d171607dd02b387e2c754c11d8dadc1b63",
  mainPayloadBytes: 3764918,
  mainPayloadSha256: "0f212c6e4ce8cb1ec4e3b8726723dfc011f009564be6845ca1940c5a0013f47a",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_64 = Object.freeze({
  version: "2.2.10.64",
  reportedVersion: "2.2.10.64",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "a384d345ac42a508f0cffa78e5c3dde65da577e1491e3d03f1839a11778c85e9",
  mainPayloadBytes: 3760726,
  mainPayloadSha256: "89c246b3dbd0faa695b7a4c903da609f7b54b259e2819afd6c09489c88132f7d",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_65 = Object.freeze({
  version: "2.2.10.65",
  reportedVersion: "2.2.10.65",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "f133271f06e68f3a51de9a661190e455888829ea4d1cecbdc3a976f2d89798a6",
  mainPayloadBytes: 3763846,
  mainPayloadSha256: "a566cf0ffddffb27e4b758a51eb96fed0ad6d2036460566f708d5a4fe0f9a286",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_66 = Object.freeze({
  version: "2.2.10.66",
  reportedVersion: "2.2.10.66",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "5bcfb90a50371e831fb369ac8dea5ce93bbd72a22daa405bd3f86bd9802b3e9c",
  mainPayloadBytes: 3759890,
  mainPayloadSha256: "ba6dff6b663770b5fd5e7b9fc47a087b3518dfd9bf35b055c0e45ff55cf88cdc",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_67 = Object.freeze({
  version: "2.2.10.67",
  reportedVersion: "2.2.10.67",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "bbec70a58e9a974425048adb59b7aef82f8b59146e62682d7516ac1f5f4c227e",
  mainPayloadBytes: 3766174,
  mainPayloadSha256: "3ca55762fda96adc64a4c16cf77d51eb28e0fff3cddef37a424bdb7abd394763",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_72 = Object.freeze({
  version: "2.2.10.72",
  reportedVersion: "2.2.10.72",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "f3bd05f9adaae94cbf2a693b7259a98c11454ba270fe09311bdfd38484d1161c",
  mainPayloadBytes: 3761322,
  mainPayloadSha256: "ddf667ed12e58d81f2d3ee85b33ae94f06f40244d249df0735755b21fa731a7a",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Relay notifies are withheld (and counted) while the stock ble_msgtx queue is within reach of its silent half-capacity drop, so a lost four-channel frame shows up as a sequence gap on the phone instead of vanishing; the relay statistics record grows to 36 bytes (v3: withheld count, queue depth, display-gate timeouts); the inflate output chunk moves from the deferred task's stack into the CFW heap.",
    "Delta frames refresh only their dirty rows on the panel: the six refresh words are passed unchanged to the panel driver's asynchronous partial reflash as (0, 0, x0, y0, x1, y1) inclusive coordinates (the driver clamps to 639/479), so a mode-3 update no longer pushes the whole 640×480 panel over QSPI; keyframes still refresh everything.",
    "Moves the LE Data Length request to configure flag bit 7: bit 5 is the firmware-internal unregister-pending flag, so 2.2.10.69 cleared the request before it was issued.",
    "Display path: one zlib inflate stream per session (inflateReset per frame instead of a 34-40 KB window alloc/free through the stock heap), the display gate taken directly on the stock semaphore so a timeout drops the frame instead of touching a shadow the display task may still be copying, and a word-wise RLE fill; link: the temple requests LE Data Length Extension (251-byte TX PDUs) on the phone link when the app sets flag bit 5, so a 237-byte four-channel relay notify leaves as one air packet instead of nine.",
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_71 = Object.freeze({
  version: "2.2.10.71",
  reportedVersion: "2.2.10.71",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "aebfbedb237f7d616e136dca41af8d6b190eba5731cfd7dbd5b10d231db7e597",
  mainPayloadBytes: 3765466,
  mainPayloadSha256: "a945b792f8848a1628570dfe5348a68f5a5deeed3585fb5aaa8fc41d588664c0",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Delta frames refresh only their dirty rows on the panel: the six refresh words are passed unchanged to the panel driver's asynchronous partial reflash as (0, 0, x0, y0, x1, y1) inclusive coordinates (the driver clamps to 639/479), so a mode-3 update no longer pushes the whole 640×480 panel over QSPI; keyframes still refresh everything.",
    "Moves the LE Data Length request to configure flag bit 7: bit 5 is the firmware-internal unregister-pending flag, so 2.2.10.69 cleared the request before it was issued.",
    "Display path: one zlib inflate stream per session (inflateReset per frame instead of a 34-40 KB window alloc/free through the stock heap), the display gate taken directly on the stock semaphore so a timeout drops the frame instead of touching a shadow the display task may still be copying, and a word-wise RLE fill; link: the temple requests LE Data Length Extension (251-byte TX PDUs) on the phone link when the app sets flag bit 5, so a 237-byte four-channel relay notify leaves as one air packet instead of nine.",
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_70 = Object.freeze({
  version: "2.2.10.70",
  reportedVersion: "2.2.10.70",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "5a078184bb36fd9b839787a2d8ce8fc1ea6232447878eb2f0861fce3c19b5929",
  mainPayloadBytes: 3766366,
  mainPayloadSha256: "68691911a8b95444163b68cd7783c433d6630814bbd31346f16207c9d3a7eff1",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Moves the LE Data Length request to configure flag bit 7: bit 5 is the firmware-internal unregister-pending flag, so 2.2.10.69 cleared the request before it was issued.",
    "Display path: one zlib inflate stream per session (inflateReset per frame instead of a 34-40 KB window alloc/free through the stock heap), the display gate taken directly on the stock semaphore so a timeout drops the frame instead of touching a shadow the display task may still be copying, and a word-wise RLE fill; link: the temple requests LE Data Length Extension (251-byte TX PDUs) on the phone link when the app sets flag bit 5, so a 237-byte four-channel relay notify leaves as one air packet instead of nine.",
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_69 = Object.freeze({
  version: "2.2.10.69",
  reportedVersion: "2.2.10.69",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "53095137f5d4d9461501054007bf00f99f8fcfbaa1eae9f476a5bec61d9f26c5",
  mainPayloadBytes: 3763714,
  mainPayloadSha256: "3f82bb3d5e4fd2be1adb19e1eb0217009ddcb66124008c38ff40a077d3680cd2",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Display path: one zlib inflate stream per session (inflateReset per frame instead of a 34-40 KB window alloc/free through the stock heap), the display gate taken directly on the stock semaphore so a timeout drops the frame instead of touching a shadow the display task may still be copying, and a word-wise RLE fill; link: the temple requests LE Data Length Extension (251-byte TX PDUs) on the phone link when the app sets flag bit 5, so a 237-byte four-channel relay notify leaves as one air packet instead of nine.",
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const REVIEWED_CFW_2_2_10_68 = Object.freeze({
  version: "2.2.10.68",
  reportedVersion: "2.2.10.68",
  baseVersion: "2.2.10.10",
  baseSha256: "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  sha256: "aa3a40e23f4aa8d554a3e9d9f4b931994bd2562b386c41e6b8f8683bd0659a9c",
  mainPayloadBytes: 3764070,
  mainPayloadSha256: "5753f9e567368c78ca7ca0489e981c744c43e9323306eed0caec2121b3f35d18",
  capabilityMarker: "Faceclaw/3",
  capabilities: [
    "Local test candidate built from stock 2.2.10.10 and g2flash d968c2c (Faceclaw firmware revision 3) with reviewed overlays of mic_control.c and patch_compress.py.",
    "Stop hands PCM slot 0 back only from the tap itself (never from the watchdog timer), so a stock microphone that re-registered the slot during the hand-back is never unregistered by mistake.",
    "Both temples power-cycle their codec (required for clean audio, and doing it on both keeps the right temple's phone link alive), and the left temple completes its bring-up several seconds after the right so the right-to-left inter-temple audio sync has finished before the left starts — the arrangement meant to bring up both temples clean at once.",
    "A CONFIGURE that arrives while the once-per-boot codec settle is in progress is treated as a lease renewal instead of a session restart, so the phone's silent-side retries can no longer cancel the deferred bring-up — the left temple previously never finished settling and streamed nothing.",
    "The CFW context is now stamped with its own size and validated on every access, so a firmware candidate never reuses a context created by a different layout; and a host reboot is detected from the OS tick running backwards between control ops, so the once-per-boot codec power-cycle actually re-runs after every reboot (the context lives in reserved SRAM and had been silently surviving warm resets and re-flashes).",
    "After the one-shot power-cycle the codec is given time to boot, then its I2S is de-initialised and re-initialised on the fully-booted chip before the tap is registered — the power-cycle's own I2S init runs while the chip is still booting and locks to garbage, and every arm that ever went clean had this I2S off→on cycle after the power-cycle.",
    "Power-cycles the GX8002 voice codec exactly once per host boot on the first arm (the only bring-up that yields clean audio; it cleans both temples via the inter-temple sync), tolerates the one link rebuild that costs, then every re-arm is a plain bring-up on the freshly-cycled codec — both temples clean with no further reboots or link disruption for the life of the boot. The one-shot flag lives in the reserved-RAM context (repurposed unused als_reserved) and survives link rebuilds.",
    "Legacy: both temples use one symmetric self-owned codec path: reboot the GX8002 voice codec, reconfigure and enable it, and suppress the codec-audio watchdog while it settles — no audio-manager slot hold and no dependence on the stock mic, so the four-mic array fully owns the codec equally on left and right.",
    "Reboots the GX8002 voice codec chip at arm time (its own firmware-level reboot, which the phone-side restart never triggered) and reconfigures it from cold, to clear a wedged codec state that made the microphone-array capture stream full-scale noise.",
    "Registers as an audio-manager client (holds an app-slot) on the left temple while tapping, so the manager keeps the shared codec up when the stock voice path releases its slot — without the held slot the codec was torn down and its I2S deinitialised mid-session.",
    "When the stock codec is already running (its I2S initialised, producing clean samples) the four-mic tap simply takes over PCM slot 0 and leaves the codec untouched — the array replaces the stock mic by stealing its slot on a live codec, never by re-initialising it (every re-init left I2S down and streamed full-scale noise); it falls back to the stock codec bring-up only if the codec is down.",
    "Legacy: brings the codec up the exact way the stock audio manager does — the codec-prep (GX8002 configuration) step that every earlier candidate skipped, then the I2S enable — so the four-microphone capture produces valid audio instead of the codec's free-running noise; the four-mic interface fully replaces the stock 1-mic interface and stays up for the whole session.",
    "Legacy note: before arming the codec, if it is still powered from a prior stock release (which on the left leaves it half-powered: chip on, I2S torn down, the state that made the DMA stream full-scale noise) it is cold-cycled — a full deinit then a clean init — so capture always starts from a cold codec the way stock does.",
    "Codec-source arming follows the stock audio manager's rules in both modes: the tap takes PCM slot 0 and the codec is opened only if its I2S is not already running; the codec audio-check flag is cleared while frames flow; on stop the codec is powered down only if this session powered it up and no stock app holds it, and slot 0 is handed back to the stock LC3 fallback only after the audio thread has processed the power-down (tap-driven, 200 ms timer fallback) so no stock-format packet leaks from either temple.",
    "Requests the fast connection profile from the phone itself when a microphone-array session arms (stock only asked when its own stream backpressured, so every earlier candidate ran on the phone's 30 ms default); fast profile at the stock 15-30 ms values (the one shape Apple centrals accept without doubt) with the connection-parameter request-path state (requested, accepted, deferred, budget, request counter) appended to the 'ML' record; both temples report the granted phone-link connection parameters as an 'ML' record; codec-driver state diagnostics; sliced 16 kHz ADPCM four-microphone stream; left-temple status mirror.",
    "Fixes the four-microphone capture seams for 2.2.10: SVC_PcmAppRegister takes (owner, slot, callback) and service_algo_process takes (pcm, length, ssr, angle).",
    "Forwards idle taps, long presses, releases and head-up wakes while the phone holds the wake lease; reports R1 battery through the glasses.",
    "Adds full-panel rendering, compressed images, cached textures and text, and wear and gesture forwarding.",
    "Includes upstream compass configuration with sample diagnostics, ambient-light sensing, and microphone controls.",
    "Changes only the Apollo application payload and package identity; all five other component payloads match stock.",
    "Pending manual hardware testing; unavailable in the public firmware catalog.",
  ],
});
export const G2_FIRMWARE_REVOCATIONS = Object.freeze([
  Object.freeze({
    version: "2.2.8.7",
    sha256: REVIEWED_CFW_2_2_8_7.sha256,
    reason: "contains the retired BLE advertised-name modification",
  }),
  Object.freeze({
    version: "2.2.8.8",
    sha256: REVIEWED_CFW_2_2_8_8.sha256,
    reason: "contains the retired BLE advertised-name modification",
  }),
  Object.freeze({
    version: "2.2.8.9",
    sha256: REVIEWED_CFW_2_2_8_9.sha256,
    reason: "contains the retired BLE advertised-name modification",
  }),
  Object.freeze({
    version: "2.2.8.10",
    sha256: REVIEWED_CFW_2_2_8_10.sha256,
    reason:
      "hardware transcripts associate its BLE advertised-name hook with loss of Bluetooth discovery",
  }),
]);

export function findG2FirmwareRevocation(fileSha256) {
  const digest = String(fileSha256 ?? "").toLowerCase();
  return (
    G2_FIRMWARE_REVOCATIONS.find(
      (revocation) => revocation.sha256 === digest,
    ) ?? null
  );
}
const HARDWARE_VALIDATED_CFW_2_2_6_11 = Object.freeze({
  sha256: "d2fb5dcef485b1bb14818b8dc56811b9d278d6fc2b81e56c496c53b72aaa1e86",
});
const LEGACY_HARDWARE_TESTED_CFW = Object.freeze({
  sha256: "5c1539fd39c599e6035f6a8ec0779ba687c250d342a24c21a39952fed6c56aa0",
  mainPayloadSha256:
    "38dea7dc05e832e6f5aea8fa726454b2ec44055af5d456b323448ee6989e53d1",
});
export const POGO_TRANSFER_RESEARCH = Object.freeze({
  asOf: "2026-07-30",
  directTempleHost: Object.freeze({
    status: "offline-validated",
    offlineTestsPassed: 8,
    component: "Apollo main only",
    startAndHeaderReplayAllowed: false,
    dataRetryOnly: false,
    dataRetryReasons: Object.freeze([
      "no DATA replay; exact cleanup, bilateral reset/liveness, then a fresh whole-component START",
    ]),
    deferredBatchSettleMs: 1000,
    maximumDataRetries: 0,
    retryBackoffMs: Object.freeze([]),
    maximumWholeComponentRestarts: 2,
    maximumHostTimeoutWholeComponentRestarts: 3,
    persistentDataRejectionWindowRecords: 64,
    stabilityReadQueries: 1,
    preStartSettleMs: 250,
    postflightVersionRequired: true,
  }),
  caseUsbBridge: Object.freeze({
    status: "both-temples-reviewed-cfw",
    attempts: 40,
    completeWiredTransfers: 7,
    attemptedBridgeSha256: Object.freeze([
      "6780d7ba8bf9a6539719dda4111c4fbaab706c74c16cda1e41751616f69109b4",
      "82ad4f81ab3ad1ab4a27185e845811722417a19f546075e1f8d488a2ab3ee264",
      "9945e4cd3b2ba1edb2328b5ddf6d3580443d566d333aef8e4d061f2981febecd",
      "8370f0a7600a986b1b0e95b8e4798a32b03060b9e0e462bb6e4931bae2ea6833",
      "9138198c7d031f9a98a5d20c0df55293fdd3b37489c7fddeb4d94c7eed07018f",
      "08a08f45ac125a1dba6469234e56cacd32147d9e79203327987276d2fb182b02",
      "08a08f45ac125a1dba6469234e56cacd32147d9e79203327987276d2fb182b02",
      "08a08f45ac125a1dba6469234e56cacd32147d9e79203327987276d2fb182b02",
      "08a08f45ac125a1dba6469234e56cacd32147d9e79203327987276d2fb182b02",
      "050c8116a1e074ec1763989174cbc109c4ffe57996de9ba0b9ecf4ced8cb5a5a",
      "db61f28dd3fa100d85b1a0bd5653d71582c9292b6bfd362545b42b08cbd59149",
      "a5c289f64b4db41abfde57f6ef32638f001ee67ad8134a778fe7314f008a649c",
      "9ab41ffe1b906869b264c9ba3aa739f3bda0ee8bf0051cf67679c204dd86ac2c",
      "dcf27971baa964902724fc9aa2f9d0369be6874a5a84231791622bb40bf486a6",
      "eba56380f04bf00ad9d87dffbc40c3292ec5b3cee458d3607c8cffd0dcbe335b",
    ]),
    validationBoundary:
      "The hosted Easy Update accepted the exact Stock/CFW compatible-pair gate, recovered a V7 short host-response boundary without replaying DATA, and completed both CFW mains through bounded fresh-component attempts. A later Stock speed test explicitly rejected a 12 KiB deferred batch at 691,000 accepted bytes; the 6 KiB conservative profile then completed all 3,524 right-Stock records, FINISH, postflight, exact YHM restoration, Case 1.2.57 return, and final bilateral DEB0/liveness in 1,571 seconds. A 2.0.7.16 to 2.2.6.10 complete-main update then produced explicit DATA 0x54/status 1 rejections at records 2,184 and 2,219 after exact cleanup and conservative restart pacing. Because those failures were only 35 records apart, the browser now treats the pair as a persistent receiver/storage boundary and does not start a third full-component attempt. A later Case produced six zero-write/zero-transmission probes across three exact register-8 0x33 counterparts; those states now select a separately pinned exact bridge profile while all unobserved baselines remain fail-closed. Build 6454760 later reached complete cached response headers but lost 4 of 11 payload/checksum bytes twice; exact status-16 cleanup, reset, and bilateral liveness succeeded after every attempt. The browser now scans complete variable-length G2RX frames, passively replaces incomplete header or payload candidates with a later cached frame, logs every retained host USART counter, and permits one final triple-paced fresh component only after exact status-16 restoration. Keep only the exact proven pair component-differential, use the complete pinned main for cross-version Update/Restore, keep the Case boundary at 6 KiB, and stop clustered explicit DATA rejections within 64 records.",
    officialRestore: Object.freeze({
      packageSha256:
        "f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa",
      mainSha256:
        "36c5b0e499a68ac2493a497bdab9740fd3e7027730c26a9094eca47268a27863",
      right: Object.freeze({
        acceptedBytes: 3523396,
        recordsSent: 3524,
        retries: 0,
        postflightVersion: "2.2.6.10",
        caseRestoreVerified: true,
      }),
      left: Object.freeze({
        outcome: "success",
        transport: "fresh local Bluetooth recovery",
        fullPackageComponents: 6,
        blockAcks: 1053,
        componentEndVerifications: 6,
        componentEndStatus: 8,
        blockResends: 0,
        mainBytes: 3523396,
        mainBlocks: 861,
        elapsedSeconds: 468,
        postResetVersion: "2.2.6.10",
        postResetHardware: 5,
        finalBilateralResetVerified: true,
        priorWiredAcceptedBytesBeforeFailure: 85000,
        firstReviewedCfwDifferenceOffset: 41642,
      }),
    }),
    maximumPacingExplicitRejection: Object.freeze({
      observedAt: "2026-07-30",
      route: "right",
      profile: "observed-33",
      imageSha256: HARDWARE_VALIDATED_CFW_2_2_6_11.sha256,
      rejectedRecord: 494,
      acceptedBytes: 493000,
      declaredBytes: 3542584,
      templeUartErrors: 0,
      hostTransportErrors: 0,
      perRecordSettleMs: 1000,
      deferredBoundarySettleMs: 8000,
      retainedCaseRestoreVerified: true,
      finalBilateralLivenessVerified: true,
      conclusion:
        "Maximum reviewed record and true 6-KiB boundary pacing still produced a clean explicit DATA status-1 rejection at a new non-clustered offset. Do not increase Case-USB pacing again; after verified cleanup use the exact pinned fresh-BLE six-component fallback.",
    }),
    dataContactFinding:
      "GLS_L/GLS_R presence and charging voltage do not prove a live pogo data path. Repeated read-only probes consume the short app-mode route: hardware lost START after a 10-query gate but acknowledged the identical START after one fresh checksum-valid version query, so use that single query immediately before OTA.",
    interruptedStartRecovery: Object.freeze({
      classification: "wired_start_no_frame_zero_byte_boundary",
      signature:
        "A fresh route returns a checksum-valid version, then 0x52 START returns no frame while retained declared and accepted sizes remain zero.",
      startOrHeaderReplayAllowed: false,
      wiredRetryPolicy: "stop",
      fallback:
        "After verified Case/YHM cleanup and bilateral DEB0, use a fresh BLE full-package session if the temple advertises; finish with bilateral DEB0 and read-only liveness.",
      provenLeftResult:
        "Six pinned official components, 1,053 status-zero block ACKs, six END status-8 (UPDATING) verifications, zero resends, then bilateral 2.2.6.10/hardware-5 liveness.",
    }),
    bestPartialTransfer: Object.freeze({
      route: "right",
      preflightFirmware: "2.2.6.10",
      preflightHardware: 5,
      acceptedBytes: 97000,
      declaredBytes: 3539474,
      expectedSequence: 97,
      templeTxCount: 100,
      templeRxCount: 10,
      templeUartErrors: 0,
      baselineMask: "0x3ff",
      selectedMask: "0x3ff",
      restoredMask: "0x000",
      caseRestoreVerified: false,
    }),
    failClosedAttempt: Object.freeze({
      route: "right",
      preflightFirmware: "2.2.6.10",
      preflightHardware: 5,
      acceptedBytes: 0,
      hostChunkOffset: 5,
      hostRxTimeouts: 1,
      status: 16,
      progress: 3,
      baselineMask: "0x3ff",
      selectedMask: "0x3ff",
      restoredMask: "0x3ff",
      writeMask: "0x3ef",
      baseline: "810004aeae03812022ff",
      restored: "810004aeae03812022ff",
      retainedProof: "47465250dec0dec0",
      templeTxCount: 1,
      templeRxCount: 0,
      templeUartErrors: 0,
      caseApplicationVersion: "1.2.57",
      caseRestoreVerified: false,
    }),
    successfulTransfers: Object.freeze({
      right: Object.freeze({
        route: "right",
        imageSha256: LEGACY_HARDWARE_TESTED_CFW.sha256,
        mainPayloadSha256:
          "38dea7dc05e832e6f5aea8fa726454b2ec44055af5d456b323448ee6989e53d1",
        payloadBytes: 3539474,
        recordsSent: 3540,
        dataRetries: 0,
        finishAckReceived: true,
        preflightFirmware: "2.2.6.10",
        postflightFirmware: "2.2.6.10",
        hardware: 5,
        acceptedBytes: 3539474,
        expectedSequence: 3540,
        templeTxCount: 3545,
        templeRxCount: 10,
        templeUartErrors: 0,
        baselineMask: "0x3ff",
        selectedMask: "0x3ff",
        restoredMask: "0x3ff",
        baseline: "811004aeaf03812022ff",
        caseRestoreVerified: true,
        caseApplicationVersion: "1.2.57",
      }),
      left: Object.freeze({
        route: "left",
        imageSha256: LEGACY_HARDWARE_TESTED_CFW.sha256,
        mainPayloadSha256:
          "38dea7dc05e832e6f5aea8fa726454b2ec44055af5d456b323448ee6989e53d1",
        payloadBytes: 3539474,
        recordsSent: 3540,
        dataRetries: 0,
        finishAckReceived: true,
        preflightFirmware: "2.2.6.10",
        postflightFirmware: "2.2.6.10",
        hardware: 5,
        acceptedBytes: 3539474,
        expectedSequence: 3540,
        templeTxCount: 3545,
        templeRxCount: 10,
        templeUartErrors: 0,
        baselineMask: "0x3ff",
        selectedMask: "0x3ff",
        restoredMask: "0x3ff",
        baseline: "810004aeae03812022ff",
        caseRestoreVerified: true,
        caseApplicationVersion: "1.2.57",
      }),
    }),
    leftFailClosed: Object.freeze({
      route: "left",
      status: 3,
      reason: "YHM baseline is not an allowlisted seated-idle state",
      transmittedFirmwareBytes: 0,
    }),
    leftPartialTransfer: Object.freeze({
      route: "left",
      preflightFirmware: "2.2.6.10",
      preflightHardware: 5,
      acceptedBytes: 2733000,
      declaredBytes: 3539474,
      expectedSequence: 2733,
      rejectedCommand: "0x54",
      rejectedStatus: 1,
      templeTxCount: 2737,
      templeRxCount: 10,
      templeUartErrors: 0,
      baselineMask: "0x3ff",
      selectedMask: "0x3ff",
      restoredMask: "0x3ff",
      baseline: "811104afaf03812022ff",
      caseRestoreVerified: true,
      caseApplicationVersion: "1.2.57",
    }),
    persistentDataRejectionBoundary: Object.freeze({
      route: "right",
      sourceFirmware: "2.0.7.16",
      targetFirmware: "2.2.6.10",
      targetBytes: 3539474,
      rejectedCommand: "0x54",
      rejectedStatus: 1,
      firstRejectedRecord: 2184,
      firstAcceptedBytes: 2183000,
      secondRejectedRecord: 2219,
      secondAcceptedBytes: 2218000,
      recordDistance: 35,
      conservativePacingMultiplier: 2,
      cleanupVerifiedAfterEachFailure: true,
      finalBilateralLivenessVerified: true,
      observedThirdAttemptRejectedRecord: 34,
      observedThirdAttemptAcceptedBytes: 33000,
      finishAcknowledged: false,
      policy:
        "After one fresh conservative whole-component restart, stop when the same route and target explicitly reject DATA command 0x54/status 1 within 64 records of the prior rejection.",
    }),
    cachedResponseHeaderTruncation: Object.freeze({
      observedAt: "2026-07-27",
      route: "right",
      sourceFirmware: "2.2.6.10",
      targetFirmware: "2.2.6.10",
      acceptedBytesByAttempt: Object.freeze([
        2467000,
        1350000,
        1648000,
      ]),
      status: 16,
      progress: 3,
      finalHeaderSuffixBytes: 3,
      expectedHeaderSuffixBytes: 7,
      finishAcknowledged: false,
      exactCleanupVerifiedAfterEveryAttempt: true,
      finalBilateralLivenessVerified: true,
      policy:
        "After a partial cached G2RX header, passively scan a bounded 256-byte/extended-deadline window for another cached Case retransmission. Never replay the temple request; preserve the existing immutable cleanup and reset path if no complete frame arrives.",
    }),
    cachedResponsePayloadTruncation: Object.freeze({
      observedAt: "2026-07-27",
      webFlasherBuild: "6454760",
      route: "right",
      sourceFirmware: "2.2.6.10",
      targetFirmware: "2.2.6.10 CFW",
      targetBytes: 3539474,
      attempts: Object.freeze([
        Object.freeze({
          outcome: "host-timeout",
          acceptedBytes: 1350000,
          retainedStatus: 16,
        }),
        Object.freeze({
          outcome: "explicit-rejection",
          rejectedRecord: 1512,
          acceptedBytes: 1511000,
          command: "0x54",
          status: 1,
        }),
        Object.freeze({
          outcome: "host-timeout",
          acceptedBytes: 1052000,
          retainedStatus: 16,
        }),
      ]),
      finalPayloadBytes: 7,
      expectedPayloadBytes: 11,
      exactCleanupVerifiedAfterEveryAttempt: true,
      intermediateBilateralLivenessVerified: true,
      finalBilateralLivenessVerified: true,
      finishAcknowledged: false,
      policy:
        "Scan and checksum the complete variable-length G2RX frame so both incomplete headers and incomplete payload/checksum candidates can be replaced by a later cached retransmission without any temple replay. If the bounded passive scan still ends at exact retained status 16, allow one final reset-gated, triple-paced full-component restart and preserve the existing clustered explicit-rejection stop.",
    }),
    observed33YhmProfile: Object.freeze({
      observedAt: "2026-07-27",
      webFlasherBuild: "2825fce",
      caseFirmware: "1.2.57",
      rightChargingPercent: 99,
      leftChargingPercent: 99,
      baselines: Object.freeze([
        "811004aeaf03812033ff",
        "810104afae03812033ff",
        "810004aeae03812033ff",
        // Remote support 2026-07-28, case 00240024514250032037384b: both
        // temples idled in this register-8 0x33 counterpart of reviewed
        // entry 2 through every settle attempt, each stop carrying
        // byte-for-byte retained-SRAM zero-write/zero-transmission proof.
        "811104afaf03812033ff",
      ]),
      fourthBaselineObservedAt: "2026-07-28",
      fourthBaselineCaseSerial: "00240024514250032037384b",
      differsFromReviewed22ProfileOnlyAtRegister: 8,
      zeroWriteProofs: 6,
      bilateralResetAttempts: 2,
      templeBytesTransmitted: 0,
      firmwareBytesAccepted: 0,
      readOnlyBridgeSha256:
        "3ca8ed1d8d37b2edef62dcb6915b5ec4b1d439160da0a89e93aa74901d760ef6",
      writerBridgeSha256:
        "b341adc44630ffe87b572523ace82b2581785892fff6d7de4e3cf1b0c87861d2",
      offlineValidationPassed: true,
      hardwareValidation:
        "three-baseline bridges ran clean on hardware 2026-07-27/28; the four-baseline pins await their first hardware run",
      policy:
        "Select the exact observed-33 profile only from immutable retained zero-write/zero-transmission proof. Use separately SHA-256-pinned read-only and writer bridges whose only four byte changes are the four observed baseline-table register-8 values 0x22 to 0x33; retain fail-closed behavior for every unobserved baseline.",
    }),
    observed45YhmProfile: Object.freeze({
      observedAt: "2026-07-28",
      transport: "remote-support relay",
      caseFirmware: "1.2.57",
      caseSerialNumber: "001d00115845501820373941",
      rightChargingPercent: 100,
      leftChargingPercent: 99,
      baselines: Object.freeze([
        "810004aeae03812045ff",
        "811104afaf03812045ff",
        "810104afae03812045ff",
      ]),
      differsFromReviewed22ProfileOnlyAtRegister: 8,
      zeroWriteProofs: 6,
      templeBytesTransmitted: 0,
      firmwareBytesAccepted: 0,
      offlineValidationPassed: true,
      hardwareValidation: "pending first observed-45 profile run",
      policy:
        "Register 8 is a per-Case persistent identity byte, so profiles verify the protocol rather than enumerated devices or values: any register-8 variant proven by immutable retained zero-write/zero-transmission evidence whose other nine baseline bytes exactly match a patchable reviewed seated-idle entry derives its own bridges from the reviewed pinned build by patching only the four baseline-table register-8 offsets. Structural deviations - the never-patched 0x8d entry, a non-ff terminator, any other byte change - remain fail-closed, and no profile is ever selected from a Case or Smart Glasses serial number.",
    }),
    browserDifferenceCfwTest: Object.freeze({
      mode: "Stock-to-reviewed-CFW component differences",
      imageSha256: LEGACY_HARDWARE_TESTED_CFW.sha256,
      mainPayloadSha256: LEGACY_HARDWARE_TESTED_CFW.mainPayloadSha256,
      identicalComponentsSkipped: 5,
      changedComponentsTransferred: 1,
      differingBytePositions: 16117,
      right: Object.freeze({
        outcome: "success",
        recordsSent: 3540,
        acceptedBytes: 3539474,
        finishAckReceived: true,
        postflightFirmware: "2.2.6.10",
        postflightHardware: 5,
        caseApplicationVersion: "1.2.57",
      }),
      left: Object.freeze({
        outcome: "failed_or_uncertain",
        acceptedBytes: 2799000,
        rejectedRecord: 2800,
        explicitRejectionRetryDelayMs: 6500,
        exactRecordRetries: 1,
        retryOutcome: "no complete temple response",
        finishAckReceived: false,
        installedProvenance: "previously verified official Stock",
      }),
      freshLeftSetupRetries: Object.freeze({
        attempts: 2,
        status: 3,
        firmwareBytesTransmitted: 0,
        secondAttemptSettleMs: 90000,
      }),
      finalReset: Object.freeze({
        command: "DEB0",
        caseApplicationVersion: "1.2.57",
        leftPresent: true,
        rightPresent: true,
        bothApplicationsVerified: true,
      }),
      repeatLeftSetupGuard: Object.freeze({
        observedAt: "2026-07-26",
        outcome: "failed_or_uncertain",
        routePhaseSetupAttempts: 4,
        status: 3,
        otaMutationAttempted: false,
        firmwareBytesAccepted: 0,
        finishAckReceived: false,
        retainedRouteRestorationProofComplete: false,
        caseApplicationVersion: "1.2.57",
        finalStandaloneReset: Object.freeze({
          command: "DEB0",
          leftPresent: true,
          rightPresent: true,
          bothApplicationsVerified: true,
        }),
      }),
      defaultBilateralStockTest: Object.freeze({
        observedAt: "2026-07-26",
        defaults: Object.freeze({
          target: "latest official Stock",
          route: "both",
          transferMode: "complete",
        }),
        targetImageSha256:
          "f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa",
        targetMainSha256:
          "36c5b0e499a68ac2493a497bdab9740fd3e7027730c26a9094eca47268a27863",
        right: Object.freeze({
          outcome: "failed_or_uncertain",
          acceptedBytes: 338000,
          acceptedRecords: 338,
          rejectedRecord: 339,
          exactRecordRetries: 1,
          retryOutcome: "no complete temple response",
          finishAckReceived: false,
          caseRestoreVerified: true,
          installedProvenance: "failed_or_uncertain",
        }),
        left: Object.freeze({
          transferAttempted: false,
          installedProvenance: "previously verified official Stock",
        }),
        finalReset: Object.freeze({
          command: "DEB0",
          caseApplicationVersion: "1.2.57",
          leftPresent: true,
          rightPresent: true,
          bothApplicationsVerified: true,
        }),
      }),
      codeDefectFoundAndFixed:
        "The browser writer referenced TempleRejectedError without importing it. The import and explicit-rejection classifier regression test were added before the successful right run.",
    }),
    currentSourceReviewGate:
      "v7-complete-target-main-live-compatible-pair-and-complete-cached-frame-recovery",
    declaredBytes: 2952,
    declaredSha256:
      "eba56380f04bf00ad9d87dffbc40c3292ec5b3cee458d3607c8cffd0dcbe335b",
    observedBytes: 2952,
    observedSha256:
      "eba56380f04bf00ad9d87dffbc40c3292ec5b3cee458d3607c8cffd0dcbe335b",
    hardwareAttemptsWithCurrentSource: 6,
    successfulHardwareAttemptsWithCurrentSource: 2,
    postRestoreReset: Object.freeze({
      status: "hardware-validated-revived-left-temple",
      caseApplicationVersion: "1.2.57",
      command: "DEB0",
      implementationEvidence:
        "Case 1.2.57 confirmed the traced DEB0 command; a separately reopened console then reported both contacts before checksum-valid read-only version queries succeeded on both routes.",
      postResetConsoleBehavior:
        "The reset-confirmation session returned no later A3 telemetry. Closing it, waiting for the temple links, and opening a new normal-console session restored fresh A0/A3 observation.",
      before: Object.freeze({
        leftPresent: false,
        rightPresent: true,
        leftApplicationReply: false,
      }),
      after: Object.freeze({
        leftPresent: true,
        rightPresent: true,
        leftFirmware: "2.2.6.10",
        leftHardware: 5,
        rightFirmware: "2.2.6.10",
        rightHardware: 5,
        bothDisplaysWorking: true,
      }),
      firmwareBytesTransmitted: 0,
      requiredFinalRestorePhase: Object.freeze([
        "restore the selected YHM route byte-for-byte",
        "verify the Case application returns as 1.2.57",
        "issue the traced stock B0 dual-temple reset",
        "close the reset-confirmation serial session",
        "reopen the normal console and query fresh A0/A3 state",
        "wait for both selected contacts to return",
        "require checksum-valid version liveness from every restored route",
      ]),
      provenanceBoundary:
        "The version reply proves post-reset application liveness only; exact image hashes remain the stock/CFW provenance.",
    }),
  }),
  webWriterEnabled: true,
});
export const OFFICIAL_G2_SHA256 = Object.freeze({
  "2.2.10.10": "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8",
  "2.3.0.24": "187ccf2bcc5c17a212106e8a376745511e8289c4232b634a7ea94b9bf25a0979",
  "2.0.1.14": "d45005d5f75985339b234550b384899bb89fb37cfe4de4928abc9e882f0709e2",
  "2.0.3.20": "84866f11895c34d15838736a373a50f06765232e2561fedd8ba1b62ba509c09c",
  "2.0.5.12": "83e3cc196df2d7bd74f735f2ffbfd9f01c204da2cb73a1fb6fee5119f1125e21",
  "2.0.6.14": "f3c4c40aa122f61e859b82ee5eaa296ac8fa3a96e7b9905fd8d112ded732c5da",
  "2.0.7.16": "47bdd17b9227d56566280fad42248dbecfe4fc70017ad9c74c3d949e27116b5e",
  "2.0.8.20": "a5e74e6830f4d9f4b8d06e18f11fb7e8f57383e3204504c299c413ce44940c23",
  "2.0.9.20": "4b0055531530b3206f7e3acf103e30edeba6c35ed746aba09e52083efb6a2592",
  "2.1.1.8": "1aa72ae9bd4e291866193e80f3f950eb35450d87bd3eab1ed017cb5c3875b3fa",
  "2.1.1.12": "75ca2a401f813cf23f864106f4dedbc7e00c4c4b37cd50dcf17f7e9fe503c63e",
  "2.2.0.24": "b3b0e213f7eb9568c97603a011b4a0261f9a4dbf9f7c933ff16b25aeb7efe0a6",
  "2.2.4.34": "f9a93621a7141e0ae54ca6371cd2f1b4afbffa61f302ace096e0656ba25b1754",
  "2.2.6.10": REVIEWED_CFW.baseSha256,
  "2.2.7.14": "0fced0aebcc6c88db6f76dba34f91b805d842a5fc297bfd7fa6d6a34ec83cecb",
  "2.2.8.4": "df7b8bd18727765eba73be5ab836e0ee4cfd17b5e680046003b8d608d2fbfda7",
  "2.2.9.22": "a03fbea9f68a9de6bc271daabb9f3a41c59053d1086622c76a4e990f829cc561",
});
export const FLASH_BASE = 0x08000000;
export const FLASH_SIZE = 0x80000;
export const BANK_SIZE = 0x40000;
export const OPTION_BASE = 0x1fff7800;
export const OPTION_SIZE = 128;
export const FLASH_PAGE_SIZE = 0x800;
export const DEVICE_DATA_OFFSETS = [0x3f000, 0x3f800];

function asBytes(input) {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

export function equalBytes(left, right) {
  const a = asBytes(left);
  const b = asBytes(right);
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function readU32LE(data, offset) {
  const bytes = asBytes(data);
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

export function readU32BE(data, offset) {
  const bytes = asBytes(data);
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

export function writeU32LE(data, offset, value) {
  const bytes = asBytes(data);
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

export function hex(value, width = 8) {
  return `0x${(value >>> 0).toString(16).toUpperCase().padStart(width, "0")}`;
}

export function hexBytes(data, separator = " ") {
  return [...asBytes(data)]
    .map((value) => value.toString(16).toUpperCase().padStart(2, "0"))
    .join(separator);
}

export function crc32c(data) {
  let crc = 0;
  for (const value of asBytes(data)) {
    crc = (crc ^ (value << 24)) >>> 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = ((crc << 1) ^ (crc & 0x80000000 ? 0x1edc6f41 : 0)) >>> 0;
    }
  }
  return crc >>> 0;
}

export function crc32(data) {
  let crc = 0xffffffff;
  for (const value of asBytes(data)) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = ((crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)) >>> 0;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function describePogoOtaTransfer(payloadSize) {
  if (!Number.isSafeInteger(payloadSize) || payloadSize < 0) {
    throw new Error("Pogo OTA payload size must be a nonnegative integer.");
  }
  const dataRecordCount = Math.max(1, Math.ceil(payloadSize / 1000));
  const finalDataBytes =
    payloadSize === 0 ? 0 : payloadSize % 1000 || 1000;
  return {
    dataRecordCount,
    finalSequence: (dataRecordCount - 1) & 0xff,
    finalDataBytes,
    fullDeferredBatches: Math.floor(payloadSize / 6000),
    wireRequestBytes: 143 + payloadSize + dataRecordCount * 9,
  };
}

export function describePogoOtaComponent(typeId, payloadSize) {
  const transfer = describePogoOtaTransfer(payloadSize);
  if (typeId === 1) {
    return {
      ...transfer,
      disposition: "omit",
      safetyLabel: "OMIT FROM POGO",
      commitBoundary:
        "0x55 can report success before the later direct MRAM copy to 0x00410000.",
      acknowledgement:
        "Parser result only; it does not prove the Even bootloader MRAM copy succeeded.",
    };
  }
  if (typeId === 0) {
    return {
      ...transfer,
      disposition: "capture-gated-main",
      safetyLabel: "MAIN ONLY · BOTH CASE ROUTES VALIDATED",
      commitBoundary:
        "The complete image is staged in LittleFS before its CRC, update flag, and reset.",
      acknowledgement:
        "Parser acceptance only; post-reset liveness and version verification remain mandatory.",
      startAndHeaderReplayAllowed: false,
      dataRetryOnly: false,
      dataRetryReason:
        "no DATA replay; exact cleanup, bilateral reset/liveness, then a fresh whole-component START",
      deferredBatchSettleMs: 1000,
      maximumDataRetries: 0,
      retryBackoffMs: [],
      maximumWholeComponentRestarts: 2,
      persistentDataRejectionWindowRecords: 64,
      stabilityReadQueries: 1,
      preStartSettleMs: 250,
      postflightVersionRequired: true,
    };
  }
  return {
    ...transfer,
    disposition: "capture-gated-subordinate",
    safetyLabel: "COMPONENT INSTALLER · CAPTURE-GATED",
    commitBoundary:
      "Payload first lands in LittleFS, then passes to its component-specific installer.",
    acknowledgement:
      "Parser acceptance only; it does not prove a durable write or successful installation.",
  };
}

export function additiveBigEndianWordSum(data) {
  const bytes = asBytes(data);
  let total = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    let word = 0;
    for (let index = 0; index < 4; index += 1) {
      word = (word << 8) >>> 0;
      if (offset + index < bytes.length) word |= bytes[offset + index];
    }
    total = (total + word) >>> 0;
  }
  return total;
}

export async function sha256Hex(data) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", asBytes(data));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function hasMagic(data, magic) {
  const bytes = asBytes(data);
  return (
    bytes.length >= magic.length &&
    magic.every((value, index) => bytes[index] === value)
  );
}

function readCString(data, offset, maxLength = 80) {
  const bytes = asBytes(data);
  const endLimit = Math.min(bytes.length, offset + maxLength);
  let end = offset;
  while (end < endLimit && bytes[end] !== 0) end += 1;
  return new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(offset, end),
  );
}

function ascii(data) {
  return new TextDecoder("latin1").decode(asBytes(data));
}

export function isPlausibleCaseImage(data) {
  const bytes = asBytes(data);
  if (bytes.length < 8 || bytes.length > DEVICE_DATA_OFFSETS[0]) return false;
  const stackPointer = readU32LE(bytes, 0);
  const resetHandler = readU32LE(bytes, 4);
  const resetAddress = resetHandler & ~1;
  return (
    (stackPointer & 0xff000000) === 0x20000000 &&
    (resetHandler & 1) === 1 &&
    resetAddress >= FLASH_BASE &&
    resetAddress < FLASH_BASE + bytes.length
  );
}

export function detectCaseVersion(data) {
  const match = ascii(asBytes(data).subarray(0, 0x10000)).match(
    /(?:^|[^0-9])((?:1|2)\.\d{1,3}\.\d{1,3})(?:[^0-9]|$)/,
  );
  return match?.[1] ?? "Unknown";
}

export function parseCaseComponent(payload) {
  const bytes = asBytes(payload);
  if (bytes.length < 0x28 || ascii(bytes.subarray(0, 4)) !== "EVEN") {
    throw new Error("The Charging-Case component is missing its EVEN wrapper.");
  }
  const imageSize = readU32BE(bytes, 8);
  const storedSum = readU32BE(bytes, 12);
  if (imageSize !== bytes.length - 0x20) {
    throw new Error(
      `The Charging-Case wrapper declares ${imageSize} bytes, but contains ${bytes.length - 0x20}.`,
    );
  }
  const rawImage = bytes.slice(0x20);
  const calculatedSum = additiveBigEndianWordSum(rawImage);
  if (storedSum !== calculatedSum) {
    throw new Error(
      `The Charging-Case checksum is ${hex(storedSum)}, expected ${hex(calculatedSum)}.`,
    );
  }
  if (!isPlausibleCaseImage(rawImage)) {
    throw new Error("The Charging-Case image has an invalid Cortex-M vector.");
  }
  return {
    rawImage,
    imageSize,
    checksum: storedSum,
    version: detectCaseVersion(rawImage),
  };
}

export function parseMainOTAPreamble(payload) {
  const bytes = asBytes(payload);
  if (bytes.length < 0x28) {
    throw new Error("The Apollo main-image preamble or vector is truncated.");
  }
  const sizeAndFlags = readU32LE(bytes, 0);
  const declaredTotalSize = sizeAndFlags & 0x00ffffff;
  const flags = sizeAndFlags >>> 24;
  if (declaredTotalSize !== bytes.length) {
    throw new Error(
      `The Apollo main image declares ${declaredTotalSize} bytes, but contains ${bytes.length}.`,
    );
  }
  if (flags !== 0x04) {
    throw new Error(`The Apollo main-image flags are ${hex(flags, 2)}, expected 0x04.`);
  }
  for (const offset of [0x08, 0x0c, 0x18, 0x1c]) {
    if (readU32LE(bytes, offset) !== 0) {
      throw new Error(`The Apollo main-image reserved word at ${hex(offset, 2)} is not zero.`);
    }
  }
  const storedCrc32 = readU32LE(bytes, 4);
  const calculatedCrc32 = crc32(bytes.subarray(8));
  if (storedCrc32 !== calculatedCrc32) {
    throw new Error(
      `The Apollo main image failed its inner CRC-32 check (${hex(storedCrc32)} stored, ${hex(calculatedCrc32)} calculated).`,
    );
  }
  const firmwareDataType = readU32LE(bytes, 0x10);
  if (firmwareDataType !== 0xcb) {
    throw new Error(
      `The Apollo main-image data type is ${hex(firmwareDataType)}, expected 0x000000CB.`,
    );
  }
  const runBase = readU32LE(bytes, 0x14);
  if (runBase !== APOLLO_APPLICATION_BASE) {
    throw new Error(
      `The Apollo main-image target is ${hex(runBase)}, expected ${hex(APOLLO_APPLICATION_BASE)}.`,
    );
  }
  const installedImageSize = bytes.length - 0x20;
  const installedImageEnd = runBase + installedImageSize;
  if (
    installedImageSize <= 0 ||
    installedImageEnd > APOLLO_UPDATE_FLAG_ADDRESS
  ) {
    throw new Error(
      `The Apollo main image ends at ${hex(installedImageEnd)}, beyond the update flag at ${hex(APOLLO_UPDATE_FLAG_ADDRESS)}.`,
    );
  }
  const initialStackPointer = readU32LE(bytes, 0x20);
  const resetHandler = readU32LE(bytes, 0x24);
  const resetAddress = resetHandler & ~1;
  if (
    (initialStackPointer & 0xff000000) !== 0x20000000 ||
    (resetHandler & 1) !== 1 ||
    resetAddress < runBase ||
    resetAddress >= installedImageEnd
  ) {
    throw new Error("The Apollo main image has an implausible Cortex-M vector.");
  }
  return {
    declaredTotalSize,
    flags,
    crcCheckEnabled: Boolean(sizeAndFlags & (1 << 26)),
    crc32: storedCrc32,
    firmwareDataType,
    runBase,
    installedImageSize,
    installedImageEnd,
    initialStackPointer,
    resetHandler,
  };
}

export function classifyG2Firmware(fileSha256) {
  const digest = fileSha256.toLowerCase();
  const reviewed = [
    REVIEWED_CFW_2_2_10_12,
    REVIEWED_CFW_2_2_10_13,
    REVIEWED_CFW_2_2_10_23,
    REVIEWED_CFW_2_2_10_24,
    REVIEWED_CFW_2_2_10_25,
    REVIEWED_CFW_2_2_10_26,
    REVIEWED_CFW_2_2_10_27,
    REVIEWED_CFW_2_2_10_28,
    REVIEWED_CFW_2_2_10_29,
    REVIEWED_CFW_2_2_10_30,
    REVIEWED_CFW_2_2_10_31,
    REVIEWED_CFW_2_2_10_32,
    REVIEWED_CFW_2_2_10_33,
    REVIEWED_CFW_2_2_10_34,
    REVIEWED_CFW_2_2_10_35,
    REVIEWED_CFW_2_2_10_36,
    REVIEWED_CFW_2_2_10_37,
    REVIEWED_CFW_2_2_10_38,
    REVIEWED_CFW_2_2_10_39,
    REVIEWED_CFW_2_2_10_40,
    REVIEWED_CFW_2_2_10_41,
    REVIEWED_CFW_2_2_10_42,
    REVIEWED_CFW_2_2_10_43,
    REVIEWED_CFW_2_2_10_44,
    REVIEWED_CFW_2_2_10_45,
    REVIEWED_CFW_2_2_10_46,
    REVIEWED_CFW_2_2_10_47,
    REVIEWED_CFW_2_2_10_48,
    REVIEWED_CFW_2_2_10_49,
    REVIEWED_CFW_2_2_10_50,
    REVIEWED_CFW_2_2_10_51,
    REVIEWED_CFW_2_2_10_52,
    REVIEWED_CFW_2_2_10_53,
    REVIEWED_CFW_2_2_10_54,
    REVIEWED_CFW_2_2_10_55,
    REVIEWED_CFW_2_2_10_56,
    REVIEWED_CFW_2_2_10_57,
    REVIEWED_CFW_2_2_10_58,
    REVIEWED_CFW_2_2_10_59,
    REVIEWED_CFW_2_2_10_60,
    REVIEWED_CFW_2_2_10_61,
    REVIEWED_CFW_2_2_10_72,
    // Older 2.2.10 candidates are no longer recognized: only the latest CFW is offered.
    // Earlier-generation pins stay recognizable for trust classification of an uploaded
    // file; whether a recognized image may be WRITTEN is decided by the generated
    // TEMPLE_FLASH_TARGETS allowlist, which now carries only the latest candidate.
    REVIEWED_CFW_2_2_9_43,
    REVIEWED_CFW_2_2_9_29,
    REVIEWED_CFW_2_2_9_28,
    REVIEWED_CFW_2_2_9_27,
    REVIEWED_CFW_2_2_9_25,
    REVIEWED_CFW_2_2_9_24,
    REVIEWED_CFW_2_2_9_23,
    REVIEWED_G2FLASH_CFW_2_2_6_11,
    REVIEWED_CFW_2_2_8_11,
    REVIEWED_CFW_2_2_8_10,
    REVIEWED_CFW_2_2_8_9,
    REVIEWED_CFW_2_2_8_8,
    REVIEWED_CFW_2_2_8_7,
    REVIEWED_CFW_2_2_7_16,
    REVIEWED_CFW,
  ].find(
    (release) => release.sha256 === digest,
  );
  if (reviewed) {
    return {
      channel: "custom",
      trust: "reviewed-custom",
      label: `Reviewed CFW · stock ${reviewed.baseVersion} base`,
      version: reviewed.version,
      baseVersion: reviewed.baseVersion,
      capabilityMarker: reviewed.capabilityMarker,
      capabilities: reviewed.capabilities,
    };
  }
  const official = Object.entries(OFFICIAL_G2_SHA256).find(
    ([, sha256]) => sha256 === digest,
  );
  if (official) {
    return {
      channel: "official",
      trust: "official-pinned",
      label: `Official G2 ${official[0]} · pinned SHA-256`,
      version: official[0],
      baseVersion: null,
      capabilities: [],
    };
  }
  return {
    channel: "local",
    trust: "unrecognized",
    label: "Structurally valid · publisher not recognized",
    version: null,
    baseVersion: null,
    capabilities: [],
  };
}

export function parseEvenOTA(input) {
  const bytes = asBytes(input);
  if (!hasMagic(bytes, EVENOTA_MAGIC)) {
    throw new Error("This file is not an EVENOTA firmware bundle.");
  }
  if (bytes.length < 0x40) throw new Error("The EVENOTA header is truncated.");
  const count = readU32LE(bytes, 8);
  if (count !== 5 && count !== 6) {
    throw new Error(`Expected 5 or 6 G2 components; this bundle contains ${count}.`);
  }
  const expectedNames =
    count === 6
      ? EXPECTED_COMPONENTS
      : EXPECTED_COMPONENTS.filter((name) => name !== "ota/s200_bootloader.bin");
  const expectedTypes =
    count === 6
      ? EXPECTED_COMPONENT_TYPES
      : EXPECTED_COMPONENT_TYPES.filter((typeId) => typeId !== 1);

  const components = [];
  const tocEnd = 0x40 + count * 16;
  const firstExpectedOffset = tocEnd + 16;
  if (
    firstExpectedOffset > bytes.length ||
    !equalBytes(bytes.subarray(tocEnd, firstExpectedOffset), EVENOTA_TOC_TRAILER)
  ) {
    throw new Error("The EVENOTA table trailer is missing or corrupt.");
  }
  let expectedOffset = firstExpectedOffset;

  for (let index = 0; index < count; index += 1) {
    const tocOffset = 0x40 + index * 16;
    const entryId = readU32LE(bytes, tocOffset);
    const componentOffset = readU32LE(bytes, tocOffset + 4);
    const storedSize = readU32LE(bytes, tocOffset + 8);
    const tocCrc = readU32LE(bytes, tocOffset + 12);

    if (
      componentOffset < tocEnd ||
      componentOffset + storedSize > bytes.length ||
      componentOffset + 128 > bytes.length
    ) {
      throw new Error(`Component ${index + 1} is outside the bundle.`);
    }
    if (componentOffset !== expectedOffset) {
      throw new Error(`Component ${index + 1} is not contiguous.`);
    }

    const payloadSize = readU32LE(bytes, componentOffset + 8);
    const echoedCrc = readU32LE(bytes, componentOffset + 12);
    const typeId = readU32LE(bytes, componentOffset + 0x24);
    const name = readCString(bytes, componentOffset + 48);
    if (storedSize !== payloadSize + 128) {
      throw new Error(`Component ${name || index + 1} has inconsistent sizing.`);
    }
    if (
      name !== expectedNames[index] ||
      typeId !== expectedTypes[index]
    ) {
      throw new Error(`Unexpected G2 component topology at entry ${index + 1}.`);
    }

    const payload = bytes.slice(
      componentOffset + 128,
      componentOffset + 128 + payloadSize,
    );
    const calculatedCrc = crc32c(payload);
    if (calculatedCrc !== tocCrc || calculatedCrc !== echoedCrc) {
      throw new Error(`${name} failed its CRC-32C integrity check.`);
    }
    let inner = null;
    if (typeId === 0) {
      inner = parseMainOTAPreamble(payload);
    } else if (typeId === 1) {
      const initialStackPointer = readU32LE(payload, 0);
      const resetHandler = readU32LE(payload, 4);
      const resetAddress = resetHandler & ~1;
      const bootloaderEnd = APOLLO_BOOTLOADER_BASE + payload.length;
      if (
        payload.length < 8 ||
        bootloaderEnd > APOLLO_APPLICATION_BASE ||
        (initialStackPointer & 0xff000000) !== 0x20000000 ||
        (resetHandler & 1) !== 1 ||
        resetAddress < APOLLO_BOOTLOADER_BASE ||
        resetAddress >= bootloaderEnd
      ) {
        throw new Error(
          "The Apollo bootloader exceeds its region or has an implausible Cortex-M vector.",
        );
      }
      inner = {
        runBase: APOLLO_BOOTLOADER_BASE,
        installedImageSize: payload.length,
        installedImageEnd: bootloaderEnd,
        initialStackPointer,
        resetHandler,
      };
    }
    components.push({
      index,
      entryId,
      typeId,
      name,
      offset: componentOffset,
      header: bytes.slice(componentOffset, componentOffset + 128),
      payloadSize,
      crc32c: calculatedCrc,
      payload,
      inner,
    });
    expectedOffset = componentOffset + storedSize;
  }

  if (expectedOffset !== bytes.length) {
    throw new Error("The EVENOTA component table does not close at end-of-file.");
  }
  const caseEntry = components.find((component) => component.typeId === 6);
  if (!caseEntry) {
    throw new Error("The EVENOTA bundle does not contain Charging-Case firmware.");
  }
  const chargingCase = parseCaseComponent(caseEntry.payload);
  const mainEntry = components.find((component) => component.typeId === 0);
  const versionMatch = ascii(bytes).match(/s200_v(\d+\.\d+\.\d+\.\d+)/);
  return {
    format: "EVENOTA",
    version: versionMatch?.[1] ?? "Unknown",
    components,
    chargingCase,
    mainFirmware: mainEntry?.inner ?? null,
  };
}

export async function parseFirmwareInput(input, fileName = "firmware.bin") {
  const bytes = asBytes(input);
  const fileSha256 = await sha256Hex(bytes);

  if (hasMagic(bytes, EVENOTA_MAGIC)) {
    const bundle = parseEvenOTA(bytes);
    const provenance = classifyG2Firmware(fileSha256);
    const componentImages = await Promise.all(
      bundle.components.map(async (component) => ({
        name: component.name,
        typeId: component.typeId,
        header: component.header,
        payload: component.payload,
        payloadSize: component.payloadSize,
        payloadSha256: await sha256Hex(component.payload),
        crc32c: component.crc32c,
      })),
    );
    const mainEntry = componentImages.find((component) => component.typeId === 0);
    const mainPayloadSha256 = mainEntry?.payloadSha256 ?? null;
    const firmwareRevocation = findG2FirmwareRevocation(fileSha256);
    const mainComponent = mainEntry
      ? {
          name: mainEntry.name,
          typeId: mainEntry.typeId,
          header: mainEntry.header,
          payload: mainEntry.payload,
          payloadSha256: mainPayloadSha256,
        }
      : null;
    // UI-level enablement only. The authoritative gate is
    // assertPinnedTempleFlashCandidate(), which re-hashes the payload against
    // the writer's own compiled-in pin table before any bytes are sent.
    const templeFlashTarget =
      !firmwareRevocation &&
      mainComponent?.name === "ota/s200_firmware_ota.bin" &&
      mainComponent?.typeId === 0
        ? findTempleFlashTarget(fileSha256)
        : null;
    const templeFlashEligible = Boolean(
      templeFlashTarget &&
      mainComponent?.payload.length === templeFlashTarget.mainBytes &&
      mainPayloadSha256 === templeFlashTarget.mainSha256 &&
      bundle.version === templeFlashTarget.version
    );
    return {
      kind: "bundle",
      fileName,
      fileSize: bytes.length,
      fileSha256,
      g2Version: bundle.version,
      caseVersion: bundle.chargingCase.version,
      caseImage: bundle.chargingCase.rawImage,
      mainFirmware: bundle.mainFirmware,
      mainComponent,
      provenance,
      firmwareRevocation,
      caseRecoveryEligible: provenance.channel !== "custom",
      templeFlashEligible,
      templeFlashTarget: templeFlashEligible ? templeFlashTarget : null,
      componentImages,
      components: componentImages.map(({ name, typeId, payloadSize, payloadSha256, crc32c: crc }) => ({
        name,
        typeId,
        payloadSize,
        payloadSha256,
        crc32c: hex(crc),
        pogoOta: describePogoOtaComponent(typeId, payloadSize),
      })),
    };
  }

  if (bytes.length >= 4 && ascii(bytes.subarray(0, 4)) === "EVEN") {
    const component = parseCaseComponent(bytes);
    return {
      kind: "case-component",
      fileName,
      fileSize: bytes.length,
      fileSha256,
      g2Version: null,
      caseVersion: component.version,
      caseImage: component.rawImage,
      mainFirmware: null,
      mainComponent: null,
      provenance: {
        channel: "local",
        trust: "local-case-component",
        label: "Locally supplied Case component",
        capabilities: [],
      },
      caseRecoveryEligible: true,
      templeFlashEligible: false,
      templeFlashTarget: null,
      components: [],
    };
  }

  if (isPlausibleCaseImage(bytes)) {
    return {
      kind: "raw-case",
      fileName,
      fileSize: bytes.length,
      fileSha256,
      g2Version: null,
      caseVersion: detectCaseVersion(bytes),
      caseImage: bytes.slice(),
      mainFirmware: null,
      mainComponent: null,
      provenance: {
        channel: "local",
        trust: "local-raw-case",
        label: "Locally supplied raw Case image",
        capabilities: [],
      },
      caseRecoveryEligible: true,
      templeFlashEligible: false,
      templeFlashTarget: null,
      components: [],
    };
  }

  throw new Error(
    "Unsupported firmware file. Choose a G2 EVENOTA bundle, firmware_box.bin component, or validated raw Case image.",
  );
}

export function decodeOptionBytes(input) {
  const bytes = asBytes(input);
  if (bytes.length !== OPTION_SIZE) {
    throw new Error(`Expected ${OPTION_SIZE} option bytes.`);
  }
  const userWord = readU32LE(bytes, 0);
  const complement = readU32LE(bytes, 4);
  if (((~userWord) >>> 0) !== complement) {
    throw new Error("The option-byte user word complement is invalid.");
  }
  const rdp = userWord & 0xff;
  const swapBank = Boolean((userWord >>> 20) & 1);
  const dualBank = Boolean((userWord >>> 22) & 1);
  return {
    raw: bytes.slice(),
    userWord,
    complement,
    rdp,
    swapBank,
    dualBank,
    activePhysicalBank: swapBank ? 1 : 2,
    inactivePhysicalBank: swapBank ? 2 : 1,
  };
}

export function toggledBankOptionBytes(input) {
  const decoded = decodeOptionBytes(input);
  if (decoded.rdp !== 0xaa || !decoded.dualBank) {
    throw new Error(
      "Refusing to switch banks: the Case is not in the verified level-0 dual-bank configuration.",
    );
  }
  const next = decoded.raw.slice();
  const nextUserWord = (decoded.userWord ^ (1 << 20)) >>> 0;
  writeU32LE(next, 0, nextUserWord);
  writeU32LE(next, 4, (~nextUserWord) >>> 0);
  return next;
}

export function parseConsoleReport(...chunks) {
  const text = chunks.filter(Boolean).join("\n").replace(/\0/g, "");
  const caseVersion =
    text.match(/\*{4,}\s*B200\s+(\d+\.\d+\.\d+)/)?.[1] ??
    text.match(/\bB200\s+(\d+\.\d+\.\d+),/)?.[1] ??
    null;
  const serialNumber =
    text.match(/\*{4,}\s*B200\s+\d+\.\d+\.\d+\s+([0-9A-Fa-f]{16,32})\*{4,}/)?.[1] ??
    null;
  const identifierCandidate =
    text.match(/(?:^|\n)((?:[0-9A-Fa-f]{2}\s+){7}[0-9A-Fa-f]{2})[ \t]*(?:\r?\n|$)/)?.[1]
      ?.trim()
      .toUpperCase() ?? null;
  const identifierCompact = identifierCandidate?.replaceAll(" ", "") ?? "";
  const identifier =
    /^(?:00){8}$|^(?:FF){8}$/.test(identifierCompact)
      ? null
      : identifierCandidate;
  const telemetryMatch = text.match(
    /B200\s+vol:(-?\d+)\s+pct:(-?\d+),\s*open:(\d+),\s*usb:(\d+),\s*cur:(-?\d+),\s*GLS_L:(\d+),\s*GLS_R:(\d+)\s+temp:(-?\d+)(?:,\s*chEn:(\d+),\s*aging:(\d+),\s*otaGls:(\d+))?/,
  );
  const telemetry = telemetryMatch
    ? {
        voltage: Number(telemetryMatch[1]),
        percent: Number(telemetryMatch[2]),
        open: telemetryMatch[3] === "1",
        usbPresent: telemetryMatch[4] === "1",
        current: Number(telemetryMatch[5]),
        leftPresent: telemetryMatch[6] === "1",
        rightPresent: telemetryMatch[7] === "1",
        temperature: Number(telemetryMatch[8]),
        chargingEnabled:
          telemetryMatch[9] == null ? null : telemetryMatch[9] === "1",
        aging: telemetryMatch[10] == null ? null : telemetryMatch[10] === "1",
        glassesOta:
          telemetryMatch[11] == null ? null : telemetryMatch[11] === "1",
      }
    : null;
  const templeCharging = {};
  const templeChargingPattern =
    /(?:^|\n)([LR])\s+charging:(\d+),\s*done:(\d+),\s*vol:(-?\d+)mv,\s*bat:(-?\d+),\s*cur:(-?\d+)/g;
  for (const match of text.matchAll(templeChargingPattern)) {
    templeCharging[match[1] === "L" ? "left" : "right"] = {
      charging: match[2] === "1",
      done: match[3] === "1",
      voltageMv: Number(match[4]),
      batteryPercent: Number(match[5]),
      currentRaw: Number(match[6]),
      source: "charging-case console",
    };
  }
  const scalarState = text.match(/(?:^|\n)(?:state[:=]\s*)?(-?\d+)(?:\r?\n|$)/i)?.[1] ?? null;
  return {
    text,
    caseVersion,
    serialNumber,
    identifier,
    telemetry,
    templeCharging:
      templeCharging.left || templeCharging.right ? templeCharging : null,
    scalarState,
  };
}

export function bytesToBase64(input) {
  const bytes = asBytes(input);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}
