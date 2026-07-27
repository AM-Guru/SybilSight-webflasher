import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AUTOMATIC_CASE_UPDATE,
  DEFAULT_AUTOMATIC_INSTALL_MODE,
  DEFAULT_INTERFACE_MODE,
  executeAutomaticCaseUpdate,
  executeAutomaticApply,
  mergeInstalledProvenance,
  provenanceFromSuccessfulAudit,
  resolveAutomaticCaseUpdatePlan,
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
    version: "2.2.6.11",
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
  assert.equal(DEFAULT_AUTOMATIC_CASE_UPDATE, false);
});

const latestCaseRelease = {
  channel: "official",
  caseRecoveryEligible: true,
  caseVersion: "1.2.57",
};

test("Case update is a no-op when the latest version is already installed", () => {
  assert.equal(
    resolveAutomaticCaseUpdatePlan({
      enabled: false,
      currentVersion: "1.2.57",
      targetRelease: latestCaseRelease,
    }).action,
    "none",
  );
});

test("older Case firmware requires the explicit automatic-update option", () => {
  const blocked = resolveAutomaticCaseUpdatePlan({
    enabled: false,
    currentVersion: "1.2.56",
    targetRelease: latestCaseRelease,
  });
  assert.equal(blocked.executable, false);
  assert.match(blocked.reason, /Enable “Update Charging Case first”/);

  const update = resolveAutomaticCaseUpdatePlan({
    enabled: true,
    currentVersion: "1.2.56",
    targetRelease: latestCaseRelease,
  });
  assert.equal(update.executable, true);
  assert.equal(update.action, "update");
  assert.equal(update.targetVersion, "1.2.57");
});

test("automatic Case update refuses a downgrade", () => {
  const result = resolveAutomaticCaseUpdatePlan({
    enabled: true,
    currentVersion: "1.2.58",
    targetRelease: latestCaseRelease,
  });
  assert.equal(result.executable, false);
  assert.match(result.reason, /will not downgrade/);
});

test("automatic Case update requires a fresh physical-bank map before writing", async () => {
  let stageCalled = false;
  await assert.rejects(
    () =>
      executeAutomaticCaseUpdate({
        session: {
          stageCaseImage: async () => {
            stageCalled = true;
          },
        },
        currentReport: { optionBytes: new Uint8Array(128) },
        targetFirmware: {
          caseRecoveryEligible: true,
          caseVersion: "1.2.57",
          caseImage: new Uint8Array([1]),
        },
      }),
    /pre-update active physical bank/,
  );
  assert.equal(stageCalled, false);
});

test("automatic Case update stages, activates, and re-analyzes before returning", async () => {
  const events = [];
  const optionBytes = new Uint8Array(128);
  const caseImage = new Uint8Array([1, 2, 3, 4]);
  const targetFirmware = {
    caseRecoveryEligible: true,
    caseVersion: "1.2.57",
    caseImage,
  };
  const report = {
    optionBytes,
    console: { caseVersion: "1.2.56" },
    options: {
      swapBank: false,
      activePhysicalBank: 2,
      inactivePhysicalBank: 1,
    },
    banks: {
      active: { physicalBank: 2, version: "1.2.56" },
      inactive: { physicalBank: 1, version: "1.2.54" },
    },
  };
  const updatedReport = {
    optionBytes: new Uint8Array(128),
    console: { caseVersion: "1.2.57" },
    options: {
      swapBank: true,
      activePhysicalBank: 1,
      inactivePhysicalBank: 2,
    },
    banks: {
      active: { physicalBank: 1, version: "1.2.57" },
      inactive: { physicalBank: 2, version: "1.2.56" },
    },
  };
  const result = await executeAutomaticCaseUpdate({
    session: {
      stageCaseImage: async (...args) => {
        events.push(["stage", ...args]);
        return { readbackSha256: "a".repeat(64) };
      },
      activateStagedBank: async (...args) => {
        events.push(["activate", ...args]);
        return { caseVersion: "1.2.57" };
      },
      analyze: async (...args) => {
        events.push(["analyze", ...args]);
        return updatedReport;
      },
      confirmCaseFirmwareVersion: async (...args) => {
        events.push(["confirm", ...args]);
        return {
          confirmedVersion: "1.2.57",
          confirmationCommand: "DEA0",
          confirmationAttempt: 1,
          confirmationAttempts: 3,
        };
      },
    },
    currentReport: report,
    targetFirmware,
    onStep: (step) => events.push(["step", step]),
  });

  assert.equal(result.report, updatedReport);
  assert.deepEqual(
    events.map(([event, detail]) => [event, detail]),
    [
      ["step", "stage"],
      ["stage", caseImage],
      ["step", "activate"],
      ["activate", caseImage],
      ["step", "reanalyze"],
      ["analyze", { progressBase: 0.36, progressSpan: 0.12 }],
      ["step", "verify-bank-switch"],
      ["step", "confirm"],
      ["confirm", "1.2.57"],
    ],
  );
  assert.equal(events[1][2], optionBytes);
  assert.equal(events[3][2], optionBytes);
  assert.deepEqual(result.bankSwitch, {
    verified: true,
    targetVersion: "1.2.57",
    previousActiveVersion: "1.2.56",
    fallbackVersion: "1.2.56",
    previousActivePhysicalBank: 2,
    stagedPhysicalBank: 1,
    activePhysicalBank: 1,
    fallbackPhysicalBank: 2,
    previousSwapBank: false,
    activeSwapBank: true,
  });
  assert.equal(result.confirmation.confirmationCommand, "DEA0");
});

test("automatic Case update rejects 1.2.57 when the staged bank was not activated", async () => {
  const optionBytes = new Uint8Array(128);
  let confirmationCalled = false;
  await assert.rejects(
    () =>
      executeAutomaticCaseUpdate({
        session: {
          stageCaseImage: async () => ({}),
          activateStagedBank: async () => ({ caseVersion: "1.2.57" }),
          analyze: async () => ({
            console: { caseVersion: "1.2.57" },
            options: {
              swapBank: false,
              activePhysicalBank: 2,
              inactivePhysicalBank: 1,
            },
            banks: {
              active: { physicalBank: 2, version: "1.2.57" },
              inactive: { physicalBank: 1, version: "1.2.54" },
            },
          }),
          confirmCaseFirmwareVersion: async () => {
            confirmationCalled = true;
            return { confirmedVersion: "1.2.57" };
          },
        },
        currentReport: {
          optionBytes,
          options: {
            swapBank: false,
            activePhysicalBank: 2,
            inactivePhysicalBank: 1,
          },
          banks: {
            active: { physicalBank: 2, version: "1.2.56" },
            inactive: { physicalBank: 1, version: "1.2.54" },
          },
        },
        targetFirmware: {
          caseRecoveryEligible: true,
          caseVersion: "1.2.57",
          caseImage: new Uint8Array([1]),
        },
      }),
    /bank switch was not confirmed.*nSWAP_BANK option did not toggle/i,
  );
  assert.equal(confirmationCalled, false);
});

test("automatic Case update stops before returning when fresh confirmation fails", async () => {
  const optionBytes = new Uint8Array(128);
  await assert.rejects(
    () =>
      executeAutomaticCaseUpdate({
        session: {
          stageCaseImage: async () => ({}),
          activateStagedBank: async () => ({ caseVersion: "1.2.57" }),
          analyze: async () => ({
            console: { caseVersion: "1.2.57" },
            options: {
              swapBank: true,
              activePhysicalBank: 1,
              inactivePhysicalBank: 2,
            },
            banks: {
              active: { physicalBank: 1, version: "1.2.57" },
              inactive: { physicalBank: 2, version: "1.2.56" },
            },
          }),
          confirmCaseFirmwareVersion: async () => {
            throw new Error("fresh DEA0 still reports 1.2.56");
          },
        },
        currentReport: {
          optionBytes,
          options: {
            swapBank: false,
            activePhysicalBank: 2,
            inactivePhysicalBank: 1,
          },
          banks: {
            active: { physicalBank: 2, version: "1.2.56" },
            inactive: { physicalBank: 1, version: "1.2.54" },
          },
        },
        targetFirmware: {
          caseRecoveryEligible: true,
          caseVersion: "1.2.57",
          caseImage: new Uint8Array([1]),
        },
      }),
    /fresh DEA0 still reports 1\.2\.56/,
  );
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
    installedIdentity: {
      channel: "custom",
      reportedVersion: "2.2.6.11",
      displayVersion: "2.2.6.11 CFW",
    },
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
      channel: "custom",
      reportedVersion: "2.2.6.11",
      displayVersion: "2.2.6.11 CFW",
      provenAt: "2026-07-26T00:00:00.000Z",
      proof: "verified-recovery-audit",
    },
    left: {
      imageSha256: CFW_SHA,
      channel: "custom",
      reportedVersion: "2.2.6.11",
      displayVersion: "2.2.6.11 CFW",
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
