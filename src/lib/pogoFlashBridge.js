import { equalBytes, readU32LE, sha256Hex } from "./firmware.js";
import { findTempleFlashTarget } from "./templeFlashTargets.js";

export { TEMPLE_FLASH_TARGETS, findTempleFlashTarget } from "./templeFlashTargets.js";

export const POGO_FLASH_BRIDGE_ADDRESS = 0x20010000;
export const POGO_FLASH_BRIDGE_BYTES = 2920;
export const POGO_FLASH_BRIDGE_SHA256 =
  "dcf27971baa964902724fc9aa2f9d0369be6874a5a84231791622bb40bf486a6";
export const POGO_FLASH_BRIDGE_BANNER = new TextEncoder().encode(
  "G2_POGO_FLASH_BRIDGE_V6\n",
);
export const POGO_FLASH_RESULT_ADDRESS = 0x20011a00;
export const POGO_FLASH_RESULT_LENGTH = 128;
export const POGO_FLASH_PROOF_ADDRESS = 0x20011b00;
export const POGO_FLASH_PROOF = new Uint8Array([
  0x47, 0x46, 0x52, 0x50, 0xde, 0xc0, 0xde, 0xc0,
]);
export const REVIEWED_CFW_IMAGE_SHA256 =
  "5c1539fd39c599e6035f6a8ec0779ba687c250d342a24c21a39952fed6c56aa0";
export const REVIEWED_CFW_MAIN_SHA256 =
  "38dea7dc05e832e6f5aea8fa726454b2ec44055af5d456b323448ee6989e53d1";
export const REVIEWED_CFW_MAIN_BYTES = 3539474;
export const REVIEWED_CFW_BASE_VERSION = "2.2.6.10";
export const REVIEWED_CASE_VERSION = "1.2.57";
export const POGO_FLASH_STATUS = Object.freeze({
  0: "ok",
  1: "bad host request",
  2: "command or OTA state rejected",
  3: "YHM baseline is not an allowlisted seated-idle state",
  4: "YHM route selection failed",
  5: "temple UART transmit failed",
  6: "no complete framed temple response",
  7: "YHM baseline restoration failed",
  16: "host request timeout",
});

const POGO_FLASH_BRIDGE_BASE64 = "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";

function asBytes(input) {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function bytesFromBase64(value) {
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  return result;
}

function sum8(input) {
  return [...asBytes(input)].reduce((sum, value) => (sum + value) & 0xff, 0);
}

function concatBytes(...parts) {
  const arrays = parts.map(asBytes);
  const result = new Uint8Array(
    arrays.reduce((length, part) => length + part.length, 0),
  );
  let offset = 0;
  for (const part of arrays) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function ordinaryChecksum(prefix) {
  const bytes = asBytes(prefix);
  return concatBytes(
    bytes,
    new Uint8Array([((bytes.length + 1 + 0x7d + sum8(bytes)) & 0xff)]),
  );
}

export class RetryablePogoFlashError extends Error {}
export class TempleRejectedError extends RetryablePogoFlashError {}
export class PogoFlashSafetyError extends Error {}

export const WIRED_START_NO_FRAME_RECOVERY = Object.freeze({
  classification: "wired_start_no_frame_zero_byte_boundary",
  firmwareBytesAccepted: 0,
  startOrHeaderReplayAllowed: false,
  recommendedNextTransport:
    "Fresh BLE full-package session if the temple advertises",
  recoveryRecommendation:
    "Do not replay START in this session or loop fresh wired attempts. After verified Case/YHM cleanup, issue the bilateral DEB0 reset. If the temple still advertises, use a fresh BLE connection to install the complete six-component hash-pinned package, then finish with DEB0 and read-only bilateral liveness.",
});

export const YHM_SETUP_NON_IDLE_RECOVERY = Object.freeze({
  classification: "yhm_setup_non_idle_zero_byte_boundary",
  firmwareBytesAccepted: 0,
  otaMutationAttempted: false,
  wiredRetryPolicy: "stop_after_bounded_setup_attempts",
  recoveryRecommendation:
    "Do not bypass the YHM allowlist or loop more wired setup attempts. Return the Case to firmware 1.2.57, issue the standalone bilateral DEB0 reset/recheck, and retain the existing Stock/CFW provenance because no OTA mutation began.",
});

const POGO_FLASH_ALLOWED_BASELINES = Object.freeze([
  "811104afaf038d2022ff",
  "810004aeae03812022ff",
  "811104afaf03812022ff",
  "810104afae03812022ff",
  "811004aeaf03812022ff",
]);

export function classifyPogoFlashRecoveryBoundary(
  error,
  retainedResult,
  failureStage,
) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    failureStage === "setup" &&
    message.includes("YHM baseline is not an allowlisted seated-idle state")
  ) {
    return { ...YHM_SETUP_NON_IDLE_RECOVERY };
  }
  if (
    failureStage !== "START" ||
    !message.includes("no complete temple frame") ||
    retainedResult?.declaredSize !== 0 ||
    retainedResult?.acceptedSize !== 0
  ) {
    return null;
  }
  return { ...WIRED_START_NO_FRAME_RECOVERY };
}

export async function getVerifiedPogoFlashBridgePayload() {
  const payload = bytesFromBase64(POGO_FLASH_BRIDGE_BASE64);
  const digest = await sha256Hex(payload);
  if (
    payload.length !== POGO_FLASH_BRIDGE_BYTES ||
    digest !== POGO_FLASH_BRIDGE_SHA256
  ) {
    throw new PogoFlashSafetyError(
      `The volatile flash bridge differs from the reviewed build (${payload.length} bytes, ${digest}).`,
    );
  }
  if (
    readU32LE(payload, 0) !== 0x2001f000 ||
    readU32LE(payload, 4) !== 0x20010009
  ) {
    throw new PogoFlashSafetyError(
      "The volatile flash bridge vector differs from the reviewed layout.",
    );
  }
  return payload;
}

export function crc16CcittFalse(input) {
  let crc = 0xffff;
  for (const value of asBytes(input)) {
    crc ^= value << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function makeTempleVersionRequest() {
  return ordinaryChecksum(new Uint8Array([0x24, 0, 1, 0]));
}

export function makeOtaStartRequest() {
  return ordinaryChecksum(new Uint8Array([0x52, 0, 0, 0]));
}

export function makeOtaHeaderRequest(header) {
  const bytes = asBytes(header);
  if (bytes.length !== 128) {
    throw new PogoFlashSafetyError("The Apollo main component header must be 128 bytes.");
  }
  return ordinaryChecksum(concatBytes(new Uint8Array([0x53, 0, 0, 0x80]), bytes));
}

export function makeOtaDataRequest(data, final, sequence) {
  const bytes = asBytes(data);
  if (bytes.length > 1000 || (!final && bytes.length !== 1000)) {
    throw new PogoFlashSafetyError("Each non-final 0x54 record must contain 1,000 bytes.");
  }
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xff) {
    throw new PogoFlashSafetyError("The 0x54 sequence must fit in one byte.");
  }
  const header = new Uint8Array(7);
  header.set([0x54, 0, 0]);
  const innerLength = bytes.length + 4;
  header[3] = innerLength & 0xff;
  header[4] = innerLength >>> 8;
  header[5] = final ? 1 : 0;
  header[6] = sequence;
  const crc = crc16CcittFalse(bytes);
  return concatBytes(header, bytes, new Uint8Array([crc & 0xff, crc >>> 8]));
}

export function makeOtaFinishRequest() {
  return ordinaryChecksum(new Uint8Array([0x55, 0, 0, 0]));
}

export function parseTempleFrame(frame) {
  const bytes = asBytes(frame);
  if (
    bytes.length < 5 ||
    bytes[0] !== 0x5a ||
    bytes[1] !== 0xa5 ||
    bytes[2] !== 0xff
  ) {
    throw new RetryablePogoFlashError("The temple response is not a 5A A5 FF frame.");
  }
  if (bytes.length !== bytes[3] + 5) {
    throw new RetryablePogoFlashError("The temple response length is inconsistent.");
  }
  if (bytes.at(-1) !== sum8(bytes.subarray(0, -1))) {
    throw new RetryablePogoFlashError("The temple response checksum is invalid.");
  }
  return bytes.subarray(4, -1);
}

export function decodeTempleVersion(frame) {
  const payload = parseTempleFrame(frame);
  if (
    payload.length !== 9 ||
    payload[0] !== 0x24 ||
    !equalBytes(payload.subarray(1, 4), new Uint8Array([1, 3, 5]))
  ) {
    throw new RetryablePogoFlashError("The temple version response shape is invalid.");
  }
  return {
    firmware: [...payload.subarray(4, 8)].join("."),
    hardware: payload[8],
  };
}

export function requireOtaAcknowledgement(frame, expectedCommand) {
  const payload = parseTempleFrame(frame);
  if (
    payload.length !== 5 ||
    payload[0] !== expectedCommand ||
    !equalBytes(payload.subarray(1, 4), new Uint8Array([1, 3, 1]))
  ) {
    throw new RetryablePogoFlashError(
      `The temple reply does not acknowledge 0x${expectedCommand.toString(16)}.`,
    );
  }
  if (payload[4] !== 0) {
    throw new TempleRejectedError(
      `The temple rejected 0x${expectedCommand.toString(16)} with status ${payload[4]}.`,
    );
  }
}

export function makePogoFlashSetup(
  route,
  sequence = 0x42,
  requireRoutePhase = true,
) {
  if (!["left", "right"].includes(route)) {
    throw new PogoFlashSafetyError("The flash route must be left or right.");
  }
  const request = new Uint8Array(10);
  request.set(new TextEncoder().encode("G2FW"));
  request.set(
    [1, route === "left" ? 0 : 1, requireRoutePhase ? 1 : 0, sequence, 0],
    4,
  );
  request[9] = sum8(request.subarray(0, 9));
  return request;
}

export function parsePogoFlashReady(response, setup) {
  const bytes = asBytes(response);
  const request = asBytes(setup);
  if (
    bytes.length !== 13 ||
    new TextDecoder().decode(bytes.subarray(0, 4)) !== "G2RD" ||
    bytes[4] !== 1 ||
    bytes[6] !== request[5] ||
    bytes[7] !== request[7] ||
    bytes[12] !== sum8(bytes.subarray(0, 12))
  ) {
    throw new PogoFlashSafetyError("The Case bridge ready response is invalid.");
  }
  const baselineMask = bytes[8] | (bytes[9] << 8);
  const selectedMask = bytes[10] | (bytes[11] << 8);
  if (bytes[5] !== 0) {
    throw new PogoFlashSafetyError(
      `The Case bridge stopped during setup: ${POGO_FLASH_STATUS[bytes[5]] ?? `status ${bytes[5]}`}.`,
    );
  }
  if (baselineMask !== 0x3ff || selectedMask !== 0x3ff) {
    throw new PogoFlashSafetyError(
      "The Case bridge did not prove complete baseline and selected-route reads.",
    );
  }
  return { route: bytes[6] === 0 ? "left" : "right", baselineMask, selectedMask };
}

export function makePogoFlashTransactionHeader(sequence, payloadLength) {
  return makePogoFlashHostHeader("G2TX", sequence, payloadLength);
}

export function makePogoFlashHostStressHeader(sequence, payloadLength) {
  return makePogoFlashHostHeader("G2TS", sequence, payloadLength);
}

function makePogoFlashHostHeader(magic, sequence, payloadLength) {
  if (!Number.isInteger(payloadLength) || payloadLength < 0 || payloadLength > 1009) {
    throw new PogoFlashSafetyError("The bridge transaction length is outside 0–1,009.");
  }
  const header = new Uint8Array(10);
  header.set(new TextEncoder().encode(magic));
  header.set([1, sequence, payloadLength & 0xff, payloadLength >>> 8, 0], 4);
  header[9] = sum8(header.subarray(0, 9));
  return header;
}

export function parsePogoFlashResponse(header, tail, expectedSequence) {
  const prefix = asBytes(header);
  const suffix = asBytes(tail);
  if (
    prefix.length !== 11 ||
    new TextDecoder().decode(prefix.subarray(0, 4)) !== "G2RX" ||
    prefix[4] !== 1 ||
    prefix[5] !== expectedSequence ||
    prefix[8] > 64 ||
    suffix.length !== prefix[8] + 1
  ) {
    throw new RetryablePogoFlashError("The Case bridge response header is invalid.");
  }
  const complete = concatBytes(prefix, suffix);
  if (complete.at(-1) !== sum8(complete.subarray(0, -1))) {
    throw new RetryablePogoFlashError("The Case bridge response checksum is invalid.");
  }
  return {
    sequence: prefix[5],
    status: prefix[6],
    uartErrors: prefix[7],
    otaState: prefix[9],
    captured: suffix.slice(0, -1),
  };
}

export function decodePogoFlashRetainedResult(result) {
  const bytes = asBytes(result);
  if (bytes.length !== POGO_FLASH_RESULT_LENGTH) {
    throw new PogoFlashSafetyError("The retained flash result length is invalid.");
  }
  const words = Array.from(
    { length: POGO_FLASH_RESULT_LENGTH / 4 },
    (_, index) => readU32LE(bytes, index * 4),
  );
  return {
    magic: words[0],
    progress: words[1],
    routeValue: words[2],
    route: words[2] === 0 ? "left" : "right",
    sequenceValue: words[3],
    sequence: words[3] & 0xff,
    status: words[4],
    baselineMask: words[5],
    selectedMask: words[6],
    restoredMask: words[7],
    writeMask: words[8],
    otaState: words[9],
    expectedSequence: words[10],
    declaredSize: words[11],
    acceptedSize: words[12],
    templeTxCount: words[13],
    templeRxCount: words[14],
    templeUartErrors: words[15],
    baseline: bytes.slice(64, 74),
    selected: bytes.slice(74, 84),
    restored: bytes.slice(84, 94),
    hostTxRecoveries: words[24],
    hostTxAborts: words[25],
    hostTxLastIsr: words[26],
    hostRxTimeouts: words[27],
    hostRxErrors: words[28],
    hostTcTimeouts: words[29],
    hostStage: words[30],
    hostChunkOffset: words[31],
  };
}

export function verifyPogoFlashOppositePhaseStop(result, proof, attemptedRoute) {
  const proofBytes = asBytes(proof);
  if (
    !["left", "right"].includes(attemptedRoute) ||
    !equalBytes(proofBytes, POGO_FLASH_PROOF)
  ) {
    return null;
  }
  let report;
  try {
    report = decodePogoFlashRetainedResult(result);
  } catch {
    return null;
  }
  const baselineHex = [...report.baseline]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const zeroBytes = (bytes) => bytes.every((value) => value === 0);
  const phaseCompatibleRoute = report.baseline[1] & 1 ? "right" : "left";
  if (
    report.magic !== 0x57463247 ||
    report.progress !== 3 ||
    report.routeValue !== (attemptedRoute === "left" ? 0 : 1) ||
    report.sequenceValue !== 0x42 ||
    report.status !== 3 ||
    report.baselineMask !== 0x3ff ||
    report.selectedMask !== 0 ||
    report.restoredMask !== 0 ||
    report.writeMask !== 0 ||
    report.otaState !== 0 ||
    report.expectedSequence !== 0 ||
    report.declaredSize !== 0 ||
    report.acceptedSize !== 0 ||
    report.templeTxCount !== 0 ||
    report.templeRxCount !== 0 ||
    report.templeUartErrors !== 0 ||
    !POGO_FLASH_ALLOWED_BASELINES.includes(baselineHex) ||
    !zeroBytes(report.selected) ||
    !zeroBytes(report.restored) ||
    phaseCompatibleRoute === attemptedRoute
  ) {
    return null;
  }
  return {
    ...report,
    phaseCompatibleRoute,
    noMutationPhaseStopVerified: true,
  };
}

export function parsePogoFlashRetainedResult(
  result,
  proof,
  route,
  finalSequence,
  { expectedAcceptedSize = null, expectedOtaSequence = null } = {},
) {
  const proofBytes = asBytes(proof);
  if (!equalBytes(proofBytes, POGO_FLASH_PROOF)) {
    throw new PogoFlashSafetyError("The volatile flash bridge proof is invalid.");
  }
  const report = decodePogoFlashRetainedResult(result);
  if (
    report.magic !== 0x57463247 ||
    report.progress !== 3 ||
    report.routeValue !== (route === "left" ? 0 : 1) ||
    report.route !== route ||
    report.sequenceValue !== finalSequence ||
    report.sequence !== finalSequence ||
    report.status !== 0 ||
    report.baselineMask !== 0x3ff ||
    report.selectedMask !== 0x3ff ||
    report.restoredMask !== 0x3ff ||
    report.templeUartErrors !== 0 ||
    (expectedAcceptedSize !== null &&
      (report.declaredSize !== expectedAcceptedSize ||
        report.acceptedSize !== expectedAcceptedSize)) ||
    (expectedOtaSequence !== null &&
      report.expectedSequence !== expectedOtaSequence) ||
    !equalBytes(report.baseline, report.restored)
  ) {
    throw new PogoFlashSafetyError(
      "The retained bridge result does not prove a complete byte-for-byte route restoration.",
    );
  }
  return report;
}

export async function assertPinnedTempleFlashCandidate(firmware) {
  // The bundle digest only selects which pin to check against; every field
  // below is still verified, and the payload is re-hashed here rather than
  // trusting the digest the parser reported.
  const target =
    firmware?.kind === "bundle" ? findTempleFlashTarget(firmware.fileSha256) : null;
  const observedMainSha256 = firmware?.mainComponent?.payload
    ? await sha256Hex(firmware.mainComponent.payload)
    : null;
  if (
    !target ||
    firmware.mainComponent?.name !== "ota/s200_firmware_ota.bin" ||
    firmware.mainComponent?.typeId !== 0 ||
    firmware.mainComponent?.header?.length !== 128 ||
    firmware.mainComponent?.payload?.length !== target.mainBytes ||
    firmware.mainComponent?.payloadSha256 !== target.mainSha256 ||
    observedMainSha256 !== target.mainSha256 ||
    firmware.g2Version !== target.version
  ) {
    throw new PogoFlashSafetyError(
      "Temple flashing accepts only a pinned Apollo-main component from the SybilSight verified library.",
    );
  }
  return { mainComponent: firmware.mainComponent, target };
}

/** @deprecated Retained so the reviewed-CFW pin stays independently asserted. */
export async function assertReviewedCfwFlashCandidate(firmware) {
  const { mainComponent } = await assertPinnedTempleFlashCandidate(firmware);
  if (
    firmware.fileSha256 !== REVIEWED_CFW_IMAGE_SHA256 ||
    mainComponent.payload.length !== REVIEWED_CFW_MAIN_BYTES ||
    mainComponent.payloadSha256 !== REVIEWED_CFW_MAIN_SHA256 ||
    firmware.g2Version !== REVIEWED_CFW_BASE_VERSION
  ) {
    throw new PogoFlashSafetyError(
      "Temple flashing accepts only the exact reviewed 2.2.6.10 CFW Apollo-main component.",
    );
  }
  return mainComponent;
}
