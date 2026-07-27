import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVICE_ANALYTICS_SCHEMA_VERSION,
  buildG2DeviceAnalytics,
} from "../src/lib/analytics.js";

function probe(side, operation, firmwareVersion = "2.2.6.10") {
  const version = operation === "version";
  return {
    operation,
    route: side,
    observedAt: "2026-07-25T00:00:00.000Z",
    decoded: version
      ? {
          kind: "version",
          firmwareVersion,
          hardwareRevision: 5,
        }
      : {
          kind: "status",
          batteryPercent: side === "left" ? 98 : 97,
          voltageMv: side === "left" ? 4490 : 4480,
        },
    captured: Uint8Array.from([0x5a, 0xa5, version ? 0x24 : 0x13]),
    transportProof: {
      baselineMask: 0x3ff,
      selectedMask: 0x3ff,
      restoredMask: 0x3ff,
      writeMask: 0x1ff,
      transmitted: version ? 5 : 7,
      stored: 3,
      errors: 0,
      baseline: Uint8Array.from([
        0x81, 0x10, 0x04, 0xa6, 0xa6, 3, 3, 0, 0x22, 0xff,
      ]),
    },
  };
}

function report(caseVersion = "1.2.57") {
  return {
    console: {
      text: "****** B200 1.2.57 ABCDEF0123456789 ******",
      caseVersion,
      serialNumber: "ABCDEF0123456789",
      identifier: "AA BB CC DD EE FF 00 11",
      telemetry: {
        leftPresent: true,
        rightPresent: true,
        percent: 50,
        voltage: 3900,
      },
    },
    usb: { vendorId: 0x1a86, productId: 0x7523 },
    rom: { protocolVersion: 0x31, productId: 0x0467, commands: [0x11, 0x31] },
    options: {
      rdp: 0xaa,
      dualBank: true,
      swapBank: false,
      activePhysicalBank: 2,
      inactivePhysicalBank: 1,
      userWord: 0x004000aa,
      complement: 0xffbfff55,
    },
    banks: {
      active: { physicalBank: 2, version: caseVersion, vectorValid: true },
      inactive: { physicalBank: 1, version: caseVersion, vectorValid: true },
    },
  };
}

test("separates case shell data from left/right glasses analytics", () => {
  const analytics = buildG2DeviceAnalytics({
    report: report(),
    pogoResults: {
      left: { version: probe("left", "version"), status: probe("left", "status") },
      right: { version: probe("right", "version"), status: probe("right", "status") },
    },
    generatedAt: "2026-07-25T00:00:00.000Z",
  });

  assert.equal(analytics.schemaVersion, DEVICE_ANALYTICS_SCHEMA_VERSION);
  assert.equal(analytics.chargingCase.shell.allowlistedQueries.length, 4);
  assert.match(analytics.chargingCase.shell.rawOutput, /B200/);
  assert.equal(analytics.smartGlasses.left.batteryPercent, 98);
  assert.equal(analytics.smartGlasses.right.voltageMv, 4480);
  assert.equal(
    analytics.smartGlasses.left.version.transportProof.restoredMask,
    "0x000003FF",
  );
  assert.equal(analytics.smartGlasses.recoveryAssessment.bothRoutesReady, true);
});

test("fails the glasses recovery gate without the reviewed case version", () => {
  const analytics = buildG2DeviceAnalytics({
    report: report("1.2.56"),
    pogoResults: {
      left: { version: probe("left", "version") },
      right: { version: probe("right", "version") },
    },
  });
  assert.equal(analytics.smartGlasses.recoveryAssessment.caseCompatible, false);
  assert.equal(analytics.smartGlasses.recoveryAssessment.bothRoutesReady, false);
  assert.equal(
    analytics.smartGlasses.recoveryAssessment.applicationDeadRecoveryAvailable,
    false,
  );
});

test("treats older responsive hardware-5 temples as complete-main compatible", () => {
  const analytics = buildG2DeviceAnalytics({
    report: report(),
    pogoResults: {
      left: { version: probe("left", "version", "2.1.1.12") },
      right: { version: probe("right", "version", "2.1.1.12") },
    },
  });
  assert.equal(
    analytics.smartGlasses.left.completeMainWriterCompatible,
    true,
  );
  assert.equal(
    analytics.smartGlasses.left.reviewedWriterCompatible,
    false,
  );
  assert.equal(
    analytics.smartGlasses.left.differentialSourceCompatible,
    false,
  );
  assert.equal(
    analytics.smartGlasses.recoveryAssessment.bothRoutesReady,
    true,
  );
  assert.match(
    analytics.smartGlasses.recoveryAssessment.completeMainSourceRequirement,
    /Any checksum-valid running G2 application/,
  );
});
