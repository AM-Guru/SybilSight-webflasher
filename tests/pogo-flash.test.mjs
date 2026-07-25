import assert from "node:assert/strict";
import test from "node:test";
import {
  POGO_FLASH_BRIDGE_BYTES,
  POGO_FLASH_BRIDGE_SHA256,
  POGO_FLASH_PROOF,
  POGO_FLASH_RESULT_LENGTH,
  PogoFlashSafetyError,
  REVIEWED_CFW_BASE_VERSION,
  REVIEWED_CFW_IMAGE_SHA256,
  REVIEWED_CFW_MAIN_BYTES,
  REVIEWED_CFW_MAIN_SHA256,
  RetryablePogoFlashError,
  TempleRejectedError,
  assertReviewedCfwFlashCandidate,
  crc16CcittFalse,
  decodeTempleVersion,
  getVerifiedPogoFlashBridgePayload,
  makeOtaDataRequest,
  makeOtaFinishRequest,
  makeOtaStartRequest,
  makePogoFlashSetup,
  makePogoFlashTransactionHeader,
  makeTempleVersionRequest,
  parsePogoFlashReady,
  parsePogoFlashResponse,
  parsePogoFlashRetainedResult,
  requireOtaAcknowledgement,
} from "../src/lib/pogoFlashBridge.js";
import { sha256Hex, writeU32LE } from "../src/lib/firmware.js";

function makeTempleFrame(payload) {
  const frame = new Uint8Array(payload.length + 5);
  frame.set([0x5a, 0xa5, 0xff, payload.length]);
  frame.set(payload, 4);
  frame[frame.length - 1] =
    frame.subarray(0, -1).reduce((sum, value) => (sum + value) & 0xff, 0);
  return frame;
}

function makeBridgeResponse(sequence, captured, { status = 0, uartErrors = 0 } = {}) {
  const header = new Uint8Array(11);
  header.set(new TextEncoder().encode("G2RX"));
  header.set([1, sequence, status, uartErrors, captured.length, 0, 0], 4);
  const tail = new Uint8Array(captured.length + 1);
  tail.set(captured);
  const complete = new Uint8Array(header.length + tail.length);
  complete.set(header);
  complete.set(tail, header.length);
  tail[tail.length - 1] =
    complete.subarray(0, -1).reduce((sum, value) => (sum + value) & 0xff, 0);
  return { header, tail };
}

test("pins the hardware-validated volatile flash bridge", async () => {
  const payload = await getVerifiedPogoFlashBridgePayload();
  assert.equal(payload.length, POGO_FLASH_BRIDGE_BYTES);
  assert.equal(await sha256Hex(payload), POGO_FLASH_BRIDGE_SHA256);
  assert.deepEqual(
    [...payload.subarray(0, 8)],
    [0x00, 0xf0, 0x01, 0x20, 0x09, 0x00, 0x01, 0x20],
  );
});

test("matches recovered temple request and CRC vectors", () => {
  assert.equal(crc16CcittFalse(new TextEncoder().encode("123456789")), 0x29b1);
  assert.equal(Buffer.from(makeTempleVersionRequest()).toString("hex"), "24000100a7");
  assert.equal(Buffer.from(makeOtaStartRequest()).toString("hex"), "52000000d4");
  assert.equal(Buffer.from(makeOtaFinishRequest()).toString("hex"), "55000000d7");
  assert.equal(
    Buffer.from(makeOtaDataRequest(new Uint8Array(), true, 0)).toString("hex"),
    "54000004000100ffff",
  );
});

test("validates setup, stop-and-wait framing, and bridge response checksums", () => {
  const setup = makePogoFlashSetup("right");
  assert.equal(Buffer.from(setup).toString("hex"), "4732465701010042005a");
  const ready = new Uint8Array([
    0x47, 0x32, 0x52, 0x44, 1, 0, 1, 0x42, 0xff, 3, 0xff, 3, 0,
  ]);
  ready[12] = ready
    .subarray(0, 12)
    .reduce((sum, value) => (sum + value) & 0xff, 0);
  assert.deepEqual(parsePogoFlashReady(ready, setup), {
    route: "right",
    baselineMask: 0x3ff,
    selectedMask: 0x3ff,
  });
  assert.equal(
    Buffer.from(makePogoFlashTransactionHeader(7, 1009)).toString("hex"),
    "473254580107f1030021",
  );

  const captured = makeTempleFrame(new Uint8Array([0x54, 1, 3, 1, 0]));
  const response = makeBridgeResponse(7, captured);
  assert.deepEqual(parsePogoFlashResponse(response.header, response.tail, 7), {
    sequence: 7,
    status: 0,
    uartErrors: 0,
    otaState: 0,
    captured,
  });
  response.tail[0] ^= 1;
  assert.throws(
    () => parsePogoFlashResponse(response.header, response.tail, 7),
    RetryablePogoFlashError,
  );
});

test("requires exact temple reply shapes and zero status", () => {
  const version = decodeTempleVersion(
    makeTempleFrame(new Uint8Array([0x24, 1, 3, 5, 2, 2, 6, 10, 5])),
  );
  assert.deepEqual(version, { firmware: "2.2.6.10", hardware: 5 });
  requireOtaAcknowledgement(
    makeTempleFrame(new Uint8Array([0x54, 1, 3, 1, 0])),
    0x54,
  );
  assert.throws(
    () =>
      requireOtaAcknowledgement(
        makeTempleFrame(new Uint8Array([0x54, 1, 3, 1, 1])),
        0x54,
      ),
    TempleRejectedError,
  );
});

test("binds retained restoration proof to route and final host sequence", () => {
  const result = new Uint8Array(POGO_FLASH_RESULT_LENGTH);
  for (const [offset, value] of [
    [0, 0x57463247],
    [4, 3],
    [8, 1],
    [12, 0x63],
    [16, 0],
    [20, 0x3ff],
    [24, 0x3ff],
    [28, 0x3ff],
    [40, 3540],
    [44, REVIEWED_CFW_MAIN_BYTES],
    [48, REVIEWED_CFW_MAIN_BYTES],
    [60, 0],
  ]) {
    writeU32LE(result, offset, value);
  }
  const baseline = Uint8Array.from([0x81, 0, 4, 0xae, 0xae, 3, 0x81, 0x20, 0x22, 0xff]);
  result.set(baseline, 64);
  result.set(baseline, 84);
  const report = parsePogoFlashRetainedResult(
    result,
    POGO_FLASH_PROOF,
    "right",
    0x63,
    {
      expectedAcceptedSize: REVIEWED_CFW_MAIN_BYTES,
      expectedOtaSequence: 3540,
    },
  );
  assert.equal(report.restoredMask, 0x3ff);
  assert.throws(
    () => parsePogoFlashRetainedResult(result, POGO_FLASH_PROOF, "left", 0x63),
    PogoFlashSafetyError,
  );
  assert.throws(
    () => parsePogoFlashRetainedResult(result, POGO_FLASH_PROOF, "right", 0x64),
    PogoFlashSafetyError,
  );
  writeU32LE(result, 48, REVIEWED_CFW_MAIN_BYTES - 1);
  assert.throws(
    () =>
      parsePogoFlashRetainedResult(
        result,
        POGO_FLASH_PROOF,
        "right",
        0x63,
        {
          expectedAcceptedSize: REVIEWED_CFW_MAIN_BYTES,
          expectedOtaSequence: 3540,
        },
      ),
    PogoFlashSafetyError,
  );
});

test("rehashes the main payload at the final reviewed-CFW trust gate", async () => {
  const payload = new Uint8Array(REVIEWED_CFW_MAIN_BYTES);
  const candidate = {
    kind: "bundle",
    fileSha256: REVIEWED_CFW_IMAGE_SHA256,
    g2Version: REVIEWED_CFW_BASE_VERSION,
    mainComponent: {
      name: "ota/s200_firmware_ota.bin",
      typeId: 0,
      header: new Uint8Array(128),
      payload,
      payloadSha256: REVIEWED_CFW_MAIN_SHA256,
    },
  };
  await assert.rejects(
    () => assertReviewedCfwFlashCandidate(candidate),
    PogoFlashSafetyError,
  );
});
