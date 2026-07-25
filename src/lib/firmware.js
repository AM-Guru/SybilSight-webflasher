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
export const REVIEWED_CFW = Object.freeze({
  version: "2.2.6.10-cfw",
  baseVersion: "2.2.6.10",
  baseSha256: "f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa",
  sha256: "5c1539fd39c599e6035f6a8ec0779ba687c250d342a24c21a39952fed6c56aa0",
  mainPayloadBytes: 3539474,
  mainPayloadSha256:
    "38dea7dc05e832e6f5aea8fa726454b2ec44055af5d456b323448ee6989e53d1",
  capabilities: [
    "576×288 image containers",
    "RLE and LZ4 image payloads",
    "8bpp XOR-delta frame updates",
    "Per-lens stereo image pairs",
    "Settings capability field 100",
    "Ring long-press and release events",
  ],
});
export const POGO_TRANSFER_RESEARCH = Object.freeze({
  asOf: "2026-07-25",
  directTempleHost: Object.freeze({
    status: "offline-validated",
    offlineTestsPassed: 8,
    component: "Apollo main only",
    startAndHeaderReplayAllowed: false,
    dataRetryOnly: true,
    dataRetryReasons: Object.freeze([
      "lost reply after an accepted record",
      "explicit record rejection without sequence advance",
    ]),
    deferredBatchSettleMs: 250,
    maximumDataRetries: 5,
    retryBackoffMs: Object.freeze([250, 500, 750, 1000, 1250]),
    stabilityReadQueries: 1,
    preStartSettleMs: 250,
    postflightVersionRequired: true,
  }),
  caseUsbBridge: Object.freeze({
    status: "official-both-case-usb-right-ble-left",
    attempts: 20,
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
    ]),
    validationBoundary:
      "Attempts 6 and 9 completed the reviewed CFW Apollo-main transfer on the right and left running temples. Case USB completed the pinned official Apollo-main transfer on the right. After an interrupted 85,000-byte wired left transfer left product-test START unreliable, a fresh upstream BLE session completed all six pinned official left components with 1,053 status-zero block ACKs, six verified END results, and zero resends.",
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
        transport: "fresh local BLE via reviewed jimrandomh/g2flash.py",
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
        imageSha256: REVIEWED_CFW.sha256,
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
        imageSha256: REVIEWED_CFW.sha256,
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
    currentSourceReviewGate:
      "hardware-validated-route-phase-fail-closed-and-selected-version",
    declaredBytes: 2912,
    declaredSha256:
      "db61f28dd3fa100d85b1a0bd5653d71582c9292b6bfd362545b42b08cbd59149",
    observedBytes: 2912,
    observedSha256:
      "db61f28dd3fa100d85b1a0bd5653d71582c9292b6bfd362545b42b08cbd59149",
    hardwareAttemptsWithCurrentSource: 5,
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
      dataRetryOnly: true,
      deferredBatchSettleMs: 250,
      maximumDataRetries: 5,
      retryBackoffMs: [250, 500, 750, 1000, 1250],
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
  if (digest === REVIEWED_CFW.sha256) {
    return {
      channel: "custom",
      trust: "reviewed-custom",
      label: `Reviewed CFW · stock ${REVIEWED_CFW.baseVersion} base`,
      version: REVIEWED_CFW.version,
      baseVersion: REVIEWED_CFW.baseVersion,
      capabilities: REVIEWED_CFW.capabilities,
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
    const mainEntry = bundle.components.find((component) => component.typeId === 0);
    const mainPayloadSha256 = mainEntry
      ? await sha256Hex(mainEntry.payload)
      : null;
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
      caseRecoveryEligible: provenance.channel !== "custom",
      templeFlashEligible,
      templeFlashTarget: templeFlashEligible ? templeFlashTarget : null,
      components: bundle.components.map(({ name, typeId, payloadSize, crc32c: crc }) => ({
        name,
        typeId,
        payloadSize,
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
  const identifier =
    text.match(/(?:^|\n)((?:[0-9A-Fa-f]{2}\s+){7}[0-9A-Fa-f]{2})(?:\r?\n|$)/)?.[1]
      ?.trim()
      .toUpperCase() ?? null;
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
  const scalarState = text.match(/(?:^|\n)(?:state[:=]\s*)?(-?\d+)(?:\r?\n|$)/i)?.[1] ?? null;
  return { text, caseVersion, serialNumber, identifier, telemetry, scalarState };
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
