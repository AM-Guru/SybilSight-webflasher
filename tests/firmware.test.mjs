import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  APOLLO_APPLICATION_BASE,
  APOLLO_BOOTLOADER_BASE,
  EXPECTED_COMPONENTS,
  EXPECTED_COMPONENT_TYPES,
  POGO_TRANSFER_RESEARCH,
  REVIEWED_CFW,
  additiveBigEndianWordSum,
  classifyG2Firmware,
  crc32,
  crc32c,
  decodeOptionBytes,
  describePogoOtaComponent,
  describePogoOtaTransfer,
  parseConsoleReport,
  parseEvenOTA,
  parseFirmwareInput,
  readU32LE,
  toggledBankOptionBytes,
  writeU32LE,
} from "../src/lib/firmware.js";
import {
  POGO_BRIDGE_SHA256,
  getVerifiedPogoBridgePayload,
  makePogoBridgeRequest,
  parsePogoBridgeResponse,
  parseTempleFrame,
  validatePogoBridgeRetainedResult,
} from "../src/lib/pogoBridge.js";
import {
  decodeApollo510RecoveryConfig,
} from "../src/lib/recoveryConfig.js";

function writeU32BE(data, offset, value) {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
}

function makeCaseComponent() {
  const raw = new Uint8Array(0x1000);
  raw.fill(0xff);
  writeU32LE(raw, 0, 0x20002c88);
  writeU32LE(raw, 4, 0x08000101);
  raw.set(new TextEncoder().encode("1.2.57\0"), 0x220);
  const wrapped = new Uint8Array(0x20 + raw.length);
  wrapped.set(new TextEncoder().encode("EVEN"), 0);
  writeU32BE(wrapped, 8, raw.length);
  writeU32BE(wrapped, 12, additiveBigEndianWordSum(raw));
  wrapped.set(raw, 0x20);
  return wrapped;
}

function makeBootloader() {
  const payload = new Uint8Array(0x100);
  writeU32LE(payload, 0, 0x2007fb00);
  writeU32LE(payload, 4, APOLLO_BOOTLOADER_BASE + 0x21);
  return payload;
}

function makeMainFirmware() {
  const payload = new Uint8Array(0x60);
  writeU32LE(payload, 0, (0x04 << 24) | payload.length);
  writeU32LE(payload, 0x10, 0xcb);
  writeU32LE(payload, 0x14, APOLLO_APPLICATION_BASE);
  writeU32LE(payload, 0x20, 0x2007fb00);
  writeU32LE(payload, 0x24, APOLLO_APPLICATION_BASE + 0x21);
  writeU32LE(payload, 4, crc32(payload.subarray(8)));
  return payload;
}

function makeBundle({ includeBootloader = true } = {}) {
  const specs = EXPECTED_COMPONENT_TYPES.map((type, index) => ({
    type,
    name: EXPECTED_COMPONENTS[index],
  })).filter(({ type }) => includeBootloader || type !== 1);
  const payloads = specs.map(({ type }, index) => {
    if (type === 6) return makeCaseComponent();
    if (type === 1) return makeBootloader();
    if (type === 0) return makeMainFirmware();
    return new Uint8Array([index + 1, type, 0xa5, 0x5a]);
  });
  const tableEnd = 0x40 + payloads.length * 16;
  let offset = tableEnd + 16;
  const total = offset + payloads.reduce((sum, payload) => sum + 128 + payload.length, 0);
  const bundle = new Uint8Array(total);
  bundle.set(new TextEncoder().encode("EVENOTA\0"), 0);
  writeU32LE(bundle, 8, payloads.length);
  bundle.set(new TextEncoder().encode("evenota\0"), tableEnd);

  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index];
    const table = 0x40 + index * 16;
    const componentSize = payload.length + 128;
    const checksum = crc32c(payload);
    writeU32LE(bundle, table, index + 1);
    writeU32LE(bundle, table + 4, offset);
    writeU32LE(bundle, table + 8, componentSize);
    writeU32LE(bundle, table + 12, checksum);
    writeU32LE(bundle, offset + 8, payload.length);
    writeU32LE(bundle, offset + 12, checksum);
    writeU32LE(bundle, offset + 0x24, specs[index].type);
    bundle.set(new TextEncoder().encode(`${specs[index].name}\0`), offset + 48);
    bundle.set(payload, offset + 128);
    offset += componentSize;
  }
  const versionMarker = new TextEncoder().encode("s200_v2.2.6.10");
  bundle.set(versionMarker, 16);
  return bundle;
}

test("parses a checksummed six-component EVENOTA bundle", async () => {
  const bundle = makeBundle();
  const parsed = parseEvenOTA(bundle);
  assert.equal(parsed.version, "2.2.6.10");
  assert.equal(parsed.components.length, 6);
  assert.equal(parsed.chargingCase.version, "1.2.57");
  const selected = await parseFirmwareInput(bundle, "fixture.bin");
  assert.equal(selected.kind, "bundle");
  assert.equal(selected.caseImage.length, 0x1000);
  assert.match(selected.fileSha256, /^[0-9a-f]{64}$/);
});

test("accepts the historical five-component topology without a bootloader", () => {
  const parsed = parseEvenOTA(makeBundle({ includeBootloader: false }));
  assert.equal(parsed.components.length, 5);
  assert.equal(
    parsed.components.some((component) => component.typeId === 1),
    false,
  );
  assert.equal(parsed.chargingCase.version, "1.2.57");
});

test("rejects a tampered component payload", () => {
  const bundle = makeBundle();
  bundle[bundle.length - 1] ^= 1;
  assert.throws(() => parseEvenOTA(bundle), /CRC-32C/);
});

test("rejects a missing EVENOTA table trailer", () => {
  const bundle = makeBundle();
  const tableEnd = 0x40 + EXPECTED_COMPONENTS.length * 16;
  bundle[tableEnd] ^= 1;
  assert.throws(() => parseEvenOTA(bundle), /table trailer/);
});

test("rejects a stale Apollo inner CRC even when the outer CRC is refreshed", () => {
  const bundle = makeBundle();
  const mainIndex = EXPECTED_COMPONENT_TYPES.indexOf(0);
  const tocOffset = 0x40 + mainIndex * 16;
  const componentOffset = readU32LE(bundle, tocOffset + 4);
  const payloadSize = readU32LE(bundle, componentOffset + 8);
  const payloadOffset = componentOffset + 128;
  bundle[payloadOffset + payloadSize - 1] ^= 1;
  const refreshedOuter = crc32c(
    bundle.subarray(payloadOffset, payloadOffset + payloadSize),
  );
  writeU32LE(bundle, tocOffset + 12, refreshedOuter);
  writeU32LE(bundle, componentOffset + 12, refreshedOuter);
  assert.throws(() => parseEvenOTA(bundle), /inner CRC-32/);
});

test("recognizes the exact reviewed CFW trust pin", () => {
  const trust = classifyG2Firmware(REVIEWED_CFW.sha256);
  assert.equal(trust.trust, "reviewed-custom");
  assert.equal(trust.baseVersion, "2.2.6.10");
  assert.equal(trust.capabilities.length, 6);
});

test("decodes and safely toggles a complemented option word", () => {
  const options = new Uint8Array(128);
  const userWord = 0xdeffe1aa;
  writeU32LE(options, 0, userWord);
  writeU32LE(options, 4, (~userWord) >>> 0);
  const decoded = decodeOptionBytes(options);
  assert.equal(decoded.rdp, 0xaa);
  assert.equal(decoded.dualBank, true);
  assert.equal(decoded.activePhysicalBank, 1);

  const toggled = toggledBankOptionBytes(options);
  assert.equal(readU32LE(toggled, 0), (userWord ^ (1 << 20)) >>> 0);
  assert.equal(readU32LE(toggled, 4), (~readU32LE(toggled, 0)) >>> 0);
  assert.equal(decodeOptionBytes(toggled).activePhysicalBank, 2);
  assert.deepEqual([...toggled.subarray(8)], [...options.subarray(8)]);
});

test("parses case telemetry, identifiers, lid, and temple presence", () => {
  const report = parseConsoleReport(`
Power up...
****** B200 1.2.57 ABCDEF0123456789ABCDEF01******
AA BB CC DD EE FF 10 20
****** B200 vol:3894 pct:51, open:1, usb:1, cur:1073,
GLS_L:1, GLS_R:0 temp:335, chEn:1, aging:0, otaGls:0
`);
  assert.equal(report.caseVersion, "1.2.57");
  assert.equal(report.serialNumber, "ABCDEF0123456789ABCDEF01");
  assert.equal(report.identifier, "AA BB CC DD EE FF 10 20");
  assert.equal(report.telemetry.open, true);
  assert.equal(report.telemetry.leftPresent, true);
  assert.equal(report.telemetry.rightPresent, false);
  assert.equal(report.telemetry.percent, 51);
});

test("pins the physically reviewed read-only pogo bridge payload", async () => {
  const payload = await getVerifiedPogoBridgePayload();
  assert.equal(payload.length, 1720);
  assert.equal(
    await globalThis.crypto.subtle
      .digest("SHA-256", payload)
      .then((digest) =>
        [...new Uint8Array(digest)]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join(""),
      ),
    POGO_BRIDGE_SHA256,
  );
  assert.deepEqual(
    [...makePogoBridgeRequest("version", "left")],
    [0x47, 0x32, 0x52, 0x51, 1, 2, 0, 0x42, 0, 0x61],
  );
});

test("validates bridge, temple, and retained YHM restoration proof", () => {
  const request = makePogoBridgeRequest("version", "left");
  const captured = Uint8Array.from(
    "5aa5ff09240103050202060a054d"
      .match(/../g)
      .map((value) => Number.parseInt(value, 16)),
  );
  const header = new Uint8Array([
    0x47, 0x32, 0x52, 0x53, 1, 2, 0, 0x42, 0, captured.length, 0, 0,
  ]);
  const responseWithoutChecksum = new Uint8Array(header.length + captured.length);
  responseWithoutChecksum.set(header);
  responseWithoutChecksum.set(captured, header.length);
  const tail = new Uint8Array(captured.length + 1);
  tail.set(captured);
  tail[tail.length - 1] =
    responseWithoutChecksum.reduce((sum, value) => sum + value, 0) & 0xff;
  const response = parsePogoBridgeResponse(header, tail, request);
  assert.deepEqual(parseTempleFrame(response.captured, "version"), {
    kind: "version",
    firmwareVersion: "2.2.6.10",
    hardwareRevision: 5,
  });

  const retained = new Uint8Array(160);
  retained.set(new TextEncoder().encode("GBRG"), 0);
  for (const [offset, value] of [
    [4, 2],
    [8, 2],
    [12, 0],
    [16, 0x42],
    [20, 0],
    [24, 0x3ff],
    [28, 0x3ff],
    [32, 0x3ff],
    [36, 0x1ff],
    [40, 5],
    [44, captured.length],
    [48, captured.length],
    [52, 0],
  ]) {
    writeU32LE(retained, offset, value);
  }
  const baseline = Uint8Array.from([0x81, 0x10, 0x04, 0xa6, 0xa6, 3, 3, 0, 0x22, 0xff]);
  retained.set(baseline, 56);
  retained.set(baseline, 76);
  retained.set(captured, 86);
  const proof = validatePogoBridgeRetainedResult(
    retained,
    response,
    "version",
    "left",
  );
  assert.equal(proof.writeMask, 0x1ff);
  assert.equal(proof.errors, 0);
});

test("describes the recovered component pogo OTA transfer plan offline", () => {
  assert.deepEqual(describePogoOtaTransfer(3_523_396), {
    dataRecordCount: 3524,
    finalSequence: 195,
    finalDataBytes: 396,
    fullDeferredBatches: 587,
    wireRequestBytes: 3_555_255,
  });
});

test("marks the Apollo bootloader as omitted from pogo OTA", () => {
  const bootloader = describePogoOtaComponent(1, 148_599);
  assert.equal(bootloader.disposition, "omit");
  assert.match(bootloader.commitBoundary, /0x00410000/);
  assert.match(bootloader.acknowledgement, /does not prove/);

  const main = describePogoOtaComponent(0, 3_523_396);
  assert.equal(main.disposition, "capture-gated-main");
  assert.match(main.commitBoundary, /LittleFS/);
  assert.equal(main.startAndHeaderReplayAllowed, false);
  assert.equal(main.dataRetryOnly, true);
  assert.equal(main.deferredBatchSettleMs, 250);
  assert.equal(main.maximumDataRetries, 1);
  assert.deepEqual(main.retryBackoffMs, [6500]);
  assert.equal(main.stabilityReadQueries, 1);
  assert.equal(main.preStartSettleMs, 250);
  assert.equal(main.postflightVersionRequired, true);
});

test("records successful case-pogo transfers and enables only the guarded browser writer", () => {
  assert.equal(POGO_TRANSFER_RESEARCH.directTempleHost.offlineTestsPassed, 8);
  assert.equal(POGO_TRANSFER_RESEARCH.directTempleHost.dataRetryReasons.length, 1);
  assert.equal(POGO_TRANSFER_RESEARCH.caseUsbBridge.attempts, 28);
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.status,
    "mixed-right-cfw-left-official-stock",
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.currentSourceReviewGate,
    "hardware-validated-route-phase-fail-closed-and-selected-version",
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.declaredSha256,
    POGO_TRANSFER_RESEARCH.caseUsbBridge.observedSha256,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.officialRestore.right.acceptedBytes,
    3523396,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.officialRestore.left.outcome,
    "success",
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.officialRestore.left.componentEndStatus,
    8,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.interruptedStartRecovery
      .startOrHeaderReplayAllowed,
    false,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.interruptedStartRecovery
      .wiredRetryPolicy,
    "stop",
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.directTempleHost.stabilityReadQueries,
    1,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.directTempleHost.preStartSettleMs,
    250,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.bestPartialTransfer.acceptedBytes,
    97000,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.bestPartialTransfer.declaredBytes,
    3539474,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.bestPartialTransfer.restoredMask,
    "0x000",
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.failClosedAttempt.acceptedBytes,
    0,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.failClosedAttempt.hostChunkOffset,
    5,
  );
  assert.equal(POGO_TRANSFER_RESEARCH.caseUsbBridge.failClosedAttempt.status, 16);
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.failClosedAttempt.baseline,
    POGO_TRANSFER_RESEARCH.caseUsbBridge.failClosedAttempt.restored,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.failClosedAttempt.restoredMask,
    "0x3ff",
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.failClosedAttempt.caseRestoreVerified,
    false,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.successfulTransfers.right.acceptedBytes,
    3539474,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.successfulTransfers.right.recordsSent,
    3540,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.successfulTransfers.right.finishAckReceived,
    true,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.successfulTransfers.right.caseRestoreVerified,
    true,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.successfulTransfers.left.acceptedBytes,
    3539474,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.successfulTransfers.left.recordsSent,
    3540,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.successfulTransfers.left.finishAckReceived,
    true,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.successfulTransfers.left.caseRestoreVerified,
    true,
  );
  assert.equal(POGO_TRANSFER_RESEARCH.caseUsbBridge.leftFailClosed.status, 3);
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.leftPartialTransfer.acceptedBytes,
    2733000,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.leftPartialTransfer.rejectedCommand,
    "0x54",
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.leftPartialTransfer.rejectedStatus,
    1,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.leftPartialTransfer.caseRestoreVerified,
    true,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.hardwareAttemptsWithCurrentSource,
    8,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.successfulHardwareAttemptsWithCurrentSource,
    2,
  );
  assert.equal(POGO_TRANSFER_RESEARCH.caseUsbBridge.attempts, 28);
  assert.equal(POGO_TRANSFER_RESEARCH.caseUsbBridge.completeWiredTransfers, 5);
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.browserDifferenceCfwTest.right
      .finishAckReceived,
    true,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.browserDifferenceCfwTest.left
      .rejectedRecord,
    2800,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.browserDifferenceCfwTest.left
      .finishAckReceived,
    false,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.postRestoreReset.command,
    "DEB0",
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.postRestoreReset.before.leftPresent,
    false,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.postRestoreReset.after.leftPresent,
    true,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.postRestoreReset.after.bothDisplaysWorking,
    true,
  );
  assert.equal(
    POGO_TRANSFER_RESEARCH.caseUsbBridge.postRestoreReset.firmwareBytesTransmitted,
    0,
  );
  assert.equal(POGO_TRANSFER_RESEARCH.webWriterEnabled, true);
});

test("decodes Apollo510 INFOC and INFO0 recovery provisioning offline", () => {
  const infoc = new Uint8Array(0x400);
  writeU32LE(infoc, 0x250, 0x0000022a);
  writeU32LE(infoc, 0x254, 0x00020001);
  writeU32LE(infoc, 0x3fc, 0);

  const info0 = new Uint8Array(0x6c);
  writeU32LE(info0, 0x28, 0x0f4240c0);
  writeU32LE(info0, 0x2c, 0x00002a2c);
  writeU32LE(info0, 0x30, 4);
  writeU32LE(info0, 0x34, 4);
  writeU32LE(info0, 0x54, 250);
  writeU32LE(info0, 0x60, APOLLO_BOOTLOADER_BASE);
  writeU32LE(info0, 0x68, 0x60000002);

  const report = decodeApollo510RecoveryConfig({ infoc, info0 });
  assert.equal(report.wiredConfiguration.uartModule, 2);
  assert.equal(report.info0.uart.baud, 1_000_000);
  assert.equal(report.pogoMatch.allKnownFieldsMatch, true);
  assert.equal(report.decision.sblUartRestoreCandidate, true);
  assert.equal(report.decision.forcedEntryContactCandidate, true);
  assert.equal(report.decision.mramWiredRecoveryCandidate, true);
  assert.equal(report.backupReadbackProvided, false);
});

test("ships the complete official and reviewed-CFW development catalog", async () => {
  const catalog = JSON.parse(
    await readFile(
      new URL("../public/firmware-updates/source-files/index.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(catalog.schemaVersion, 2);
  assert.equal(
    catalog.releases.filter((release) => (release.channel ?? "official") === "official")
      .length,
    12,
  );
  const cfw = catalog.releases.find((release) => release.channel === "custom");
  assert.equal(cfw.version, "2.2.6.10-cfw");
  assert.equal(cfw.sha256, REVIEWED_CFW.sha256);
  assert.equal(cfw.caseRecoveryEligible, false);
});
