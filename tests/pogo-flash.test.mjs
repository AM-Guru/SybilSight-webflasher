import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  TEMPLE_FLASH_TARGETS,
  TempleRejectedError,
  assertPinnedTempleFlashCandidate,
  classifyPogoFlashRecoveryBoundary,
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
import {
  G2CaseSession,
  WEB_SERIAL_ROM_READ_SIZE,
  canRunFinalResetAfterFailure,
  isExplicitTempleDataRejection,
  isG2CaseSerialPort,
  isWebSerialRomPacketBoundary,
  retryReadOnlyBlock,
  writePogoFlashTransactionHeader,
} from "../src/lib/serial.js";

const REVIEWED_STOCK_IMAGE_SHA256 =
  "f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa";

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

test("paces the fixed transaction header across the CH340 idle boundary", async () => {
  const writes = [];
  const sleeps = [];
  const header = Uint8Array.from({ length: 10 }, (_, index) => index);
  await writePogoFlashTransactionHeader(
    {
      write: async (bytes) => writes.push([...bytes]),
    },
    header,
    async (milliseconds) => sleeps.push(milliseconds),
  );
  assert.deepEqual(writes, [
    [0, 1, 2, 3, 4],
    [5, 6, 7, 8, 9],
  ]);
  assert.deepEqual(sleeps, [5]);
});

test("re-synchronizes and rereads the exact block after a CH340 short read", async () => {
  let reads = 0;
  let resynchronizations = 0;
  const retries = [];
  const block = await retryReadOnlyBlock(
    async () => {
      reads += 1;
      if (reads < 3) {
        throw new Error(`received 31 of 128 bytes on attempt ${reads}`);
      }
      return new Uint8Array(128).fill(0xa5);
    },
    async () => {
      resynchronizations += 1;
    },
    {
      onRetry: (error, attempt) => retries.push([error.message, attempt]),
    },
  );
  assert.equal(block.length, 128);
  assert.equal(reads, 3);
  assert.equal(resynchronizations, 2);
  assert.equal(retries.length, 2);
});

test("recognizes the deterministic CH340 Web Serial packet boundary", () => {
  assert.equal(WEB_SERIAL_ROM_READ_SIZE, 31);
  assert.equal(
    isWebSerialRomPacketBoundary(
      new Error("Timed out reading memory at 0x1fff7800: received 31 of 128 bytes."),
      128,
    ),
    true,
  );
  assert.equal(
    isWebSerialRomPacketBoundary(
      new Error("Timed out reading memory at 0x1fff7800: received 30 of 128 bytes."),
      128,
    ),
    false,
  );
  assert.equal(
    isWebSerialRomPacketBoundary(
      new Error("Timed out reading memory at 0x1fff7800: received 31 of 31 bytes."),
      31,
    ),
    false,
  );
});

test("recognizes only the reviewed G2 Case USB serial identity", () => {
  assert.equal(
    isG2CaseSerialPort({
      getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
    }),
    true,
  );
  assert.equal(
    isG2CaseSerialPort({
      getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7522 }),
    }),
    false,
  );
  assert.equal(isG2CaseSerialPort({ getInfo: () => { throw new Error("gone"); } }), false);
});

test("retries only a fail-closed read-only YHM idle-phase mismatch", async () => {
  const waits = [];
  const logs = [];
  const session = new G2CaseSession(null, {
    wait: async (milliseconds) => waits.push(milliseconds),
    log: (message, level) => logs.push([message, level]),
  });
  let attempts = 0;
  session.probeRunningTempleOnce = async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error(
        "The pogo bridge stopped safely: YHM baseline was not an allowlisted seated-idle state.",
      );
    }
    return { route: "right", operation: "version" };
  };
  const result = await session.probeRunningTemple("version", "right");
  assert.deepEqual(result, { route: "right", operation: "version" });
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [500, 1000]);
  assert.equal(logs.length, 2);
});

test("classifies only an explicit temple DATA rejection for exact replay", () => {
  assert.equal(
    isExplicitTempleDataRejection(
      new TempleRejectedError("synthetic explicit DATA rejection"),
    ),
    true,
  );
  assert.equal(
    isExplicitTempleDataRejection(
      new RetryablePogoFlashError("synthetic missing or malformed reply"),
    ),
    false,
  );
});

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
  assert.equal(Buffer.from(setup).toString("hex"), "4732465701010142005b");
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

test("classifies zero-byte no-frame START as the BLE fallback boundary", () => {
  const recovery = classifyPogoFlashRecoveryBoundary(
    new Error("no complete temple frame through Case bridge"),
    { declaredSize: 0, acceptedSize: 0, templeTxCount: 2 },
    "START",
  );
  assert.equal(
    recovery.classification,
    "wired_start_no_frame_zero_byte_boundary",
  );
  assert.equal(recovery.startOrHeaderReplayAllowed, false);
  assert.match(recovery.recommendedNextTransport, /BLE full-package/);
  assert.equal(
    classifyPogoFlashRecoveryBoundary(
      new Error("no complete temple frame through Case bridge"),
      { declaredSize: 3532396, acceptedSize: 1000 },
      "START",
    ),
    null,
  );
  assert.equal(
    classifyPogoFlashRecoveryBoundary(
      new Error("no complete temple frame through Case bridge"),
      { declaredSize: 0, acceptedSize: 0, templeTxCount: 1 },
      "PREFLIGHT",
    ),
    null,
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
  await assert.rejects(
    () => assertPinnedTempleFlashCandidate(candidate),
    PogoFlashSafetyError,
  );
});

test("pins every temple-flash target to a distinct image and main digest", () => {
  assert.ok(TEMPLE_FLASH_TARGETS.length >= 2, "expected stock images beside the CFW");
  const images = new Set(TEMPLE_FLASH_TARGETS.map((t) => t.imageSha256));
  const mains = new Set(TEMPLE_FLASH_TARGETS.map((t) => t.mainSha256));
  assert.equal(images.size, TEMPLE_FLASH_TARGETS.length);
  assert.equal(mains.size, TEMPLE_FLASH_TARGETS.length);
  for (const target of TEMPLE_FLASH_TARGETS) {
    assert.match(target.imageSha256, /^[0-9a-f]{64}$/);
    assert.match(target.mainSha256, /^[0-9a-f]{64}$/);
    assert.ok(target.mainBytes > 0);
    assert.equal(typeof target.hardwareValidated, "boolean");
  }
  const validated = TEMPLE_FLASH_TARGETS.filter((t) => t.hardwareValidated);
  assert.deepEqual(
    validated.map((t) => t.imageSha256),
    [REVIEWED_CFW_IMAGE_SHA256, REVIEWED_STOCK_IMAGE_SHA256],
    "the reviewed CFW and pinned Stock image have hardware-validated transfers",
  );
});

test("keeps the generated pin table in sync with the firmware archive", async () => {
  const index = JSON.parse(
    await readFile(
      new URL(
        "../public/firmware-updates/source-files/index.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const expected = index.releases
    .map((release) => ({
      release,
      main: (release.components ?? []).find(
        (c) => c.name === "ota/s200_firmware_ota.bin" && c.typeId === 0,
      ),
    }))
    .filter(({ main }) => main?.sha256)
    .map(({ release, main }) => ({
      imageSha256: release.sha256,
      mainSha256: main.sha256,
      mainBytes: main.size,
      version: release.internalVersion ?? release.version,
      hardwareValidated:
        release.channel === "custom" ||
        release.sha256 === REVIEWED_STOCK_IMAGE_SHA256,
    }));
  assert.deepEqual(
    TEMPLE_FLASH_TARGETS.map(({ label, ...rest }) => rest),
    expected,
    "run `npm run archive:firmware` to regenerate src/lib/templeFlashTargets.js",
  );
});

test("accepts a pinned stock main but still rejects a mismatched payload", async () => {
  const stock = TEMPLE_FLASH_TARGETS.find((t) => !t.hardwareValidated);
  const make = (payload, payloadSha256) => ({
    kind: "bundle",
    fileSha256: stock.imageSha256,
    g2Version: stock.version,
    mainComponent: {
      name: "ota/s200_firmware_ota.bin",
      typeId: 0,
      header: new Uint8Array(128),
      payload,
      payloadSha256,
    },
  });
  // Right length, wrong bytes: the gate re-hashes, so this must fail closed.
  await assert.rejects(
    () => assertPinnedTempleFlashCandidate(
      make(new Uint8Array(stock.mainBytes), stock.mainSha256),
    ),
    PogoFlashSafetyError,
  );
  // A stock image must never satisfy the reviewed-CFW-specific pin.
  await assert.rejects(
    () => assertReviewedCfwFlashCandidate(
      make(new Uint8Array(stock.mainBytes), stock.mainSha256),
    ),
    PogoFlashSafetyError,
  );
});

test("makes the dual-temple reset the final restore mutation and verifies liveness", async () => {
  const events = [];
  const session = new G2CaseSession(null, {
    log: (message) => events.push(`log:${message}`),
    progress: () => {},
  });
  session.restartAndRecheck = async () => {
    events.push("mutate:DEB0");
    return {
      caseVersion: "1.2.57",
      telemetry: { leftPresent: true, rightPresent: true },
    };
  };
  session.probeRunningTemple = async (operation, route) => {
    events.push(`read:${operation}:${route}`);
    return {
      decoded: { firmwareVersion: "2.2.6.10", hardwareRevision: 5 },
      transportProof: { restoredMask: 0x3ff },
    };
  };
  session.restoreNormal = async () => {
    events.push("read:case-version");
    return { caseVersion: "1.2.57" };
  };

  const report = await session.finalizeTempleRestore(
    ["right", "left"],
    "2.2.6.10",
  );
  assert.equal(report.command, "DEB0");
  assert.equal(report.resetConfirmed, true);
  assert.deepEqual(Object.keys(report.versions), ["right", "left"]);
  assert.equal(
    events.filter((event) => event.startsWith("mutate:")).at(-1),
    "mutate:DEB0",
  );
  assert.deepEqual(
    events.filter((event) => event.startsWith("read:")),
    ["read:version:right", "read:version:left", "read:case-version"],
  );
});

test("closes the reset console and retries telemetry in reopened sessions", async () => {
  const encoder = new TextEncoder();
  const writes = [];
  const transports = [
    {
      outputs: [
        "****** B200 1.2.57 DEVICE******\r\n",
        "reset gls L & R, reason: cmd\r\n",
      ],
    },
    {
      outputs: [
        "",
        "B200 1.2.57, 3\r\n",
        "telemetry unavailable\r\n",
      ],
    },
    {
      outputs: [
        "****** B200 1.2.57 DEVICE******\r\n",
        "B200 1.2.57, 3\r\n",
        "****** B200 vol:4155 pct:100, open:1, usb:1, cur:-9, "
          + "GLS_L:1, GLS_R:1 temp:265, chEn:1, aging:0, otaGls:0\r\n",
      ],
    },
  ].map((fixture, index) => ({
    closed: false,
    clear() {},
    async write(data) {
      writes.push({ index, text: new TextDecoder().decode(data) });
    },
    async collectFor() {
      return encoder.encode(fixture.outputs.shift() ?? "");
    },
    async close() {
      this.closed = true;
    },
  }));
  let openIndex = 0;
  const session = new G2CaseSession(null, {
    openNormal: async () => {
      if (openIndex > 0) {
        assert.equal(
          transports[openIndex - 1].closed,
          true,
          "each reset/telemetry console must close before the next opens",
        );
      }
      return transports[openIndex++];
    },
    wait: async () => {},
  });

  const report = await session.restartAndRecheck();

  assert.equal(openIndex, 3);
  assert.equal(report.resetConfirmed, true);
  assert.equal(report.postResetTelemetrySession, "reopened");
  assert.equal(report.postResetTelemetryAttempt, 2);
  assert.equal(report.telemetry.leftPresent, true);
  assert.equal(report.telemetry.rightPresent, true);
  assert.deepEqual(
    writes.map(({ text }) => text),
    ["DEB0\n", "DEA0\n", "DEA3\n", "DEA0\n", "DEA3\n"],
  );
});

test("standalone reset verifies both temple applications without firmware", async () => {
  const events = [];
  const session = new G2CaseSession(null, { progress: () => {} });
  session.restartAndRecheck = async () => ({
    caseVersion: "1.2.57",
    telemetry: { leftPresent: true, rightPresent: true },
    resetConfirmed: true,
    postResetTelemetrySession: "reopened",
  });
  session.probeRunningTemple = async (operation, route) => {
    events.push(`${operation}:${route}`);
    return {
      decoded: { firmwareVersion: "2.2.6.10", hardwareRevision: 5 },
      transportProof: { restoredMask: 0x3ff },
    };
  };
  session.restoreNormal = async () => {
    events.push("case:restore");
    return { caseVersion: "1.2.57" };
  };

  const report = await session.restartAndVerifyBothTemples();

  assert.deepEqual(events, ["version:right", "version:left", "case:restore"]);
  assert.equal(report.applicationLivenessVerified, true);
  assert.equal(report.firmwareBytesTransmitted, 0);
  assert.equal(report.versions.left.firmware, "2.2.6.10");
  assert.equal(report.versions.right.hardware, 5);
});

test("fails the final restore gate when a selected contact does not return", async () => {
  const session = new G2CaseSession(null);
  session.restartAndRecheck = async () => ({
    caseVersion: "1.2.57",
    telemetry: { leftPresent: false, rightPresent: true },
  });
  session.probeRunningTemple = async () => {
    throw new Error("must not probe an absent selected route");
  };
  await assert.rejects(
    () => session.finalizeTempleRestore(["left"], "2.2.6.10"),
    /left: contact did not return/,
  );
});

test("attempts failure recovery only after every route has verified cleanup", () => {
  const verified = {
    caseRestoreVerified: true,
    caseApplicationVersion: "1.2.57",
  };
  assert.equal(canRunFinalResetAfterFailure([verified]), true);
  assert.equal(canRunFinalResetAfterFailure([]), false);
  assert.equal(
    canRunFinalResetAfterFailure([
      verified,
      { caseRestoreVerified: false, caseApplicationVersion: "1.2.57" },
    ]),
    false,
  );
});
