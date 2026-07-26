import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AUTOMATIC_INSTALL_MODE,
  DEFAULT_INTERFACE_MODE,
  executeAutomaticApply,
  mergeInstalledProvenance,
  provenanceFromSuccessfulAudit,
  resolveAutomaticApplyPlan,
} from "../src/lib/automaticRecovery.js";

const STOCK_SHA = "a".repeat(64);
const CFW_SHA = "b".repeat(64);
const firmware = (sha) => ({
  fileSha256: sha,
  templeFlashEligible: true,
});
const both = (sha) => ({
  right: { imageSha256: sha },
  left: { imageSha256: sha },
});
const differencePlan = {
  executable: true,
  changedMainOnly: true,
  source: {
    imageSha256: STOCK_SHA,
    mainSha256: "c".repeat(64),
    version: "2.2.6.10",
  },
  target: {
    imageSha256: CFW_SHA,
    mainSha256: "d".repeat(64),
    version: "2.2.6.10",
  },
  wireTransfer: {
    component: "ota/s200_firmware_ota.bin",
    bytes: 1234,
    sparseByteRangesSupported: false,
  },
  verification: {
    targetBundleSha256: CFW_SHA,
    targetMainSha256: "d".repeat(64),
    targetMainBytes: 1234,
    finishAcknowledgementRequired: true,
    postResetLivenessRequired: true,
    finalDualTempleResetRequired: true,
  },
};

test("defaults to Easy Mode and differential Update", () => {
  assert.equal(DEFAULT_INTERFACE_MODE, "easy");
  assert.equal(DEFAULT_AUTOMATIC_INSTALL_MODE, "update");
});

test("Restore always plans a complete bilateral rewrite", () => {
  assert.deepEqual(
    resolveAutomaticApplyPlan({
      installMode: "restore",
      targetFirmware: firmware(STOCK_SHA),
    }),
    {
      executable: true,
      action: "flash",
      route: "both",
      flashMode: "complete",
      targetSha256: STOCK_SHA,
      reason: "Rewrite the complete pinned Apollo main on both temples.",
    },
  );
});

test("Update accepts the exact full-component pair with live compatibility proof", () => {
  const result = resolveAutomaticApplyPlan({
    installMode: "update",
    targetFirmware: firmware(CFW_SHA),
    installedProvenance: {},
    differenceSourceFirmware: firmware(STOCK_SHA),
    differencePlan,
  });
  assert.equal(result.executable, true);
  assert.equal(result.sourceProofMode, "live-compatible-pair-preflight");
  assert.match(result.reason, /just-in-time checksum-valid/i);
});

test("Update prefers bilateral source-audit proof when available", () => {
  const result = resolveAutomaticApplyPlan({
    installMode: "update",
    targetFirmware: firmware(CFW_SHA),
    installedProvenance: both(STOCK_SHA),
    differenceSourceFirmware: firmware(STOCK_SHA),
    differencePlan,
  });
  assert.equal(result.executable, true);
  assert.equal(result.flashMode, "differences");
  assert.equal(result.route, "both");
  assert.equal(result.sourceProofMode, "verified-source-audits");
});

test("Update rejects unknown provenance when the plan is not a complete target-main transfer", () => {
  const result = resolveAutomaticApplyPlan({
    installMode: "update",
    targetFirmware: firmware(CFW_SHA),
    installedProvenance: {},
    differenceSourceFirmware: firmware(STOCK_SHA),
    differencePlan: {
      ...differencePlan,
      wireTransfer: {
        ...differencePlan.wireTransfer,
        sparseByteRangesSupported: true,
      },
    },
  });
  assert.equal(result.executable, false);
  assert.match(result.reason, /complete pinned target main/i);
});

test("Update rejects saved provenance outside the exact reviewed pair", () => {
  const result = resolveAutomaticApplyPlan({
    installMode: "update",
    targetFirmware: firmware(CFW_SHA),
    installedProvenance: both("e".repeat(64)),
    differenceSourceFirmware: firmware(STOCK_SHA),
    differencePlan,
  });
  assert.equal(result.executable, false);
  assert.match(result.reason, /outside the exact reviewed/i);
});

test("Update becomes reset-and-verify when both temples already prove target", () => {
  const result = resolveAutomaticApplyPlan({
    installMode: "update",
    targetFirmware: firmware(CFW_SHA),
    installedProvenance: both(CFW_SHA),
  });
  assert.equal(result.executable, true);
  assert.equal(result.action, "verify-only");
});

test("only a fully verified successful audit records installed provenance", () => {
  const audit = {
    outcome: "success",
    imageSha256: CFW_SHA,
    routes: ["right", "left"],
    finishedAt: "2026-07-26T00:00:00.000Z",
    verification: {
      everyRouteAcceptedExactTargetBytes: true,
      everyRoutePostflightVersionValid: true,
      finalDualTempleResetVerified: true,
      postResetLivenessVerified: true,
    },
  };
  assert.deepEqual(Object.keys(provenanceFromSuccessfulAudit(audit)).sort(), [
    "left",
    "right",
  ]);
  assert.deepEqual(mergeInstalledProvenance({}, audit), {
    right: {
      imageSha256: CFW_SHA,
      provenAt: "2026-07-26T00:00:00.000Z",
      proof: "verified-recovery-audit",
    },
    left: {
      imageSha256: CFW_SHA,
      provenAt: "2026-07-26T00:00:00.000Z",
      proof: "verified-recovery-audit",
    },
  });
});

test("a failed or uncertain audit clears affected route provenance", () => {
  assert.deepEqual(
    mergeInstalledProvenance(both(STOCK_SHA), {
      outcome: "failed_or_uncertain",
      routes: ["right"],
    }),
    { left: { imageSha256: STOCK_SHA } },
  );
});

test("automatic Restore invokes one complete bilateral session", async () => {
  const calls = [];
  const expectedAudit = { outcome: "success" };
  const result = await executeAutomaticApply({
    session: {
      flashPinnedTempleMain: async (...args) => {
        calls.push(args);
        return expectedAudit;
      },
    },
    installMode: "restore",
    targetFirmware: firmware(STOCK_SHA),
  });
  assert.equal(result.audit, expectedAudit);
  assert.deepEqual(calls, [
    [
      firmware(STOCK_SHA),
      "both",
      { mode: "complete", differenceSourceFirmware: null },
    ],
  ]);
});

test("automatic Update invokes the reviewed bilateral difference session", async () => {
  const calls = [];
  const source = firmware(STOCK_SHA);
  await executeAutomaticApply({
    session: {
      flashPinnedTempleMain: async (...args) => {
        calls.push(args);
        return { outcome: "success" };
      },
    },
    installMode: "update",
    targetFirmware: firmware(CFW_SHA),
    installedProvenance: both(STOCK_SHA),
    differenceSourceFirmware: source,
    differencePlan,
  });
  assert.deepEqual(calls, [
    [
      firmware(CFW_SHA),
      "both",
      {
        mode: "differences",
        differenceSourceFirmware: source,
        sourceProofMode: "verified-source-audits",
      },
    ],
  ]);
});

test("automatic Update already at target performs reset-only verification", async () => {
  let resetCalls = 0;
  const result = await executeAutomaticApply({
    session: {
      restartAndVerifyBothTemples: async () => {
        resetCalls += 1;
        return { applicationLivenessVerified: true };
      },
    },
    installMode: "update",
    targetFirmware: firmware(CFW_SHA),
    installedProvenance: both(CFW_SHA),
  });
  assert.equal(resetCalls, 1);
  assert.equal(result.action, "verify-only");
  assert.equal(result.result.applicationLivenessVerified, true);
});
