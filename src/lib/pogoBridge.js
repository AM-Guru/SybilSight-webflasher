import { equalBytes, hexBytes, readU32LE, sha256Hex } from "./firmware.js";

export const POGO_BRIDGE_ADDRESS = 0x20010000;
export const POGO_BRIDGE_RESULT_ADDRESS = 0x20011a00;
export const POGO_BRIDGE_RESULT_LENGTH = 160;
export const POGO_BRIDGE_PROOF_ADDRESS = 0x20011b00;
export const POGO_BRIDGE_SHA256 =
  "742f4652f2ce7a46fd6d0e7ab9500906ff2402198b74790fddf44ebf80006c12";
export const POGO_BRIDGE_BANNER = new TextEncoder().encode("G2_POGO_BRIDGE_V1\n");
export const POGO_BRIDGE_PROOF = new Uint8Array([
  0x47, 0x42, 0x52, 0x50, 0xde, 0xc0, 0xde, 0xc0,
]);

const POGO_BRIDGE_BASE64 = `
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
+gU=
`;

export const POGO_BRIDGE_STATUS = Object.freeze({
  0: "ok",
  1: "bad host request",
  2: "operation or route rejected",
  3: "YHM baseline was not an allowlisted seated-idle state",
  4: "YHM route selection failed",
  5: "temple request transmission failed",
  6: "no framed temple response",
  7: "YHM baseline restoration failed",
  16: "host request timeout",
});

function decodeBase64(value) {
  const binary = globalThis.atob(value.replace(/\s+/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function getVerifiedPogoBridgePayload() {
  const payload = decodeBase64(POGO_BRIDGE_BASE64);
  if (payload.length !== 1712 || payload.length % 4 !== 0) {
    throw new Error("The pinned pogo bridge payload has an unexpected size.");
  }
  const digest = await sha256Hex(payload);
  if (digest !== POGO_BRIDGE_SHA256) {
    throw new Error("The pinned pogo bridge payload failed its SHA-256 check.");
  }
  return payload;
}

export function makePogoBridgeRequest(operation, route, sequence = 0x42) {
  const operationValue = { status: 1, version: 2, exit: 0x7f }[operation];
  const routeValue = { left: 0, right: 1 }[route];
  if (operationValue == null || routeValue == null) {
    throw new Error("Unsupported pogo bridge operation or route.");
  }
  if (operation === "exit" && route !== "left") {
    throw new Error("The no-contact bridge exit self-test uses the left route field.");
  }
  const request = new Uint8Array([
    0x47, 0x32, 0x52, 0x51,
    1,
    operationValue,
    routeValue,
    sequence,
    0,
    0,
  ]);
  request[9] = request.subarray(0, 9).reduce((sum, value) => sum + value, 0) & 0xff;
  return request;
}

export function parsePogoBridgeResponse(header, tail, request) {
  const response = new Uint8Array(header.length + tail.length);
  response.set(header);
  response.set(tail, header.length);
  if (
    header.length !== 12 ||
    header[0] !== 0x47 ||
    header[1] !== 0x32 ||
    header[2] !== 0x52 ||
    header[3] !== 0x53 ||
    header[4] !== 1
  ) {
    throw new Error(`Invalid pogo bridge response header: ${hexBytes(header)}`);
  }
  const capturedLength = header[9];
  if (capturedLength > 64 || tail.length !== capturedLength + 1) {
    throw new Error("The pogo bridge returned an invalid capture length.");
  }
  const checksum = response.subarray(0, -1).reduce((sum, value) => sum + value, 0) & 0xff;
  if (response.at(-1) !== checksum) {
    throw new Error("The pogo bridge response checksum is invalid.");
  }
  if (
    request &&
    (response[5] !== request[5] ||
      response[6] !== request[6] ||
      response[7] !== request[7])
  ) {
    throw new Error("The pogo bridge response does not echo the host request.");
  }
  return {
    raw: response,
    operation: response[5],
    route: response[6],
    sequence: response[7],
    status: response[8],
    statusLabel: POGO_BRIDGE_STATUS[response[8]] ?? "unknown bridge status",
    uartErrorMask: response[10],
    captured: response.slice(12, 12 + capturedLength),
  };
}

export function parseTempleFrame(frame, operation) {
  if (
    frame.length < 5 ||
    frame[0] !== 0x5a ||
    frame[1] !== 0xa5 ||
    frame[2] !== 0xff
  ) {
    throw new Error("The temple response is not a 5A A5 FF frame.");
  }
  if (frame.length !== frame[3] + 5) {
    throw new Error("The temple response length does not match its declaration.");
  }
  const checksum = frame.subarray(0, -1).reduce((sum, value) => sum + value, 0) & 0xff;
  if (frame.at(-1) !== checksum) {
    throw new Error("The temple response additive checksum is invalid.");
  }
  if (operation === "status") {
    if (frame.length !== 15 || frame[4] !== 0x13) {
      throw new Error("The temple did not return the expected status response.");
    }
    return {
      kind: "status",
      statusFlag: frame[8],
      voltageMv: (frame[9] << 8) | frame[10],
      batteryPercent: frame[11],
      currentNonpositive: frame[12] !== 0,
      currentMagnitude: frame[13],
    };
  }
  if (operation === "version") {
    if (frame.length !== 14 || frame[4] !== 0x24) {
      throw new Error("The temple did not return the expected version response.");
    }
    return {
      kind: "version",
      firmwareVersion: `${frame[8]}.${frame[9]}.${frame[10]}.${frame[11]}`,
      hardwareRevision: frame[12],
    };
  }
  throw new Error("Only status and version temple frames are accepted.");
}

export function validatePogoBridgeRetainedResult(
  result,
  response,
  operation,
  route,
) {
  if (
    result.length !== POGO_BRIDGE_RESULT_LENGTH ||
    result[0] !== 0x47 ||
    result[1] !== 0x42 ||
    result[2] !== 0x52 ||
    result[3] !== 0x47
  ) {
    throw new Error("The retained pogo bridge result magic is invalid.");
  }
  const words = [];
  for (let offset = 4; offset < 56; offset += 4) {
    words.push(readU32LE(result, offset));
  }
  const [
    progress,
    retainedOperation,
    retainedRoute,
    sequence,
    status,
    baselineMask,
    selectedMask,
    restoredMask,
    writeMask,
    transmitted,
    total,
    stored,
    errors,
  ] = words;
  const expectedOperation = { status: 1, version: 2 }[operation];
  const expectedRoute = { left: 0, right: 1 }[route];
  if (progress !== 2) throw new Error("The retained pogo bridge run is incomplete.");
  if (retainedOperation !== expectedOperation || retainedRoute !== expectedRoute) {
    throw new Error("The retained pogo bridge operation or route differs.");
  }
  if (
    sequence !== response.sequence ||
    status !== response.status ||
    errors !== response.uartErrorMask
  ) {
    throw new Error("The retained pogo bridge result differs from its USB response.");
  }
  if (stored > 64) throw new Error("The retained pogo capture length is invalid.");
  if (!equalBytes(result.subarray(86, 86 + stored), response.captured)) {
    throw new Error("The retained temple bytes differ from the USB response.");
  }

  if (status === 0) {
    const expectedTransmitted = operation === "status" ? 7 : 5;
    if (
      baselineMask !== 0x3ff ||
      selectedMask !== 0x3ff ||
      restoredMask !== 0x3ff ||
      writeMask !== 0x1ff ||
      transmitted !== expectedTransmitted ||
      total !== stored ||
      errors !== 0 ||
      !equalBytes(result.subarray(56, 66), result.subarray(76, 86))
    ) {
      throw new Error("The retained pogo transport or YHM restoration proof failed.");
    }
  }
  return {
    baselineMask,
    selectedMask,
    restoredMask,
    writeMask,
    transmitted,
    stored,
    errors,
    baseline: result.slice(56, 66),
  };
}
