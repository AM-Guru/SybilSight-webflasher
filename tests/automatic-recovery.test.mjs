import assert from "node:assert/strict";
import test from "node:test";
import {
  canFallbackDifferentialToComplete,
  DEFAULT_AUTOMATIC_CASE_UPDATE,
  DEFAULT_AUTOMATIC_INSTALL_MODE,
  DEFAULT_INTERFACE_MODE,
  assessAutomaticTempleContacts,
  executeAutomaticCaseUpdate,
  executeAutomaticApply,
  installedProvenanceStorageKey,
  mergeInstalledProvenance,
  provenanceFromSuccessfulAudit,
  resolveAutomaticCaseUpdatePlan,
  resolveAutomaticApplyPlan,
  verifyAutomaticCaseReadiness,
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
const observedBoth = (version, hardwareRevision = 5) => ({
  right: { firmwareVersion: version, hardwareRevision },
  left: { firmwareVersion: version, hardwareRevision },
});
const caseOptionBytes = (swapBank = false) => {
  const bytes = new Uint8Array(128);
  const userWord =
    (0xaa | (1 << 22) | (swapBank ? 1 << 20 : 0)) >>> 0;
  const view = new DataView(bytes.buffer);
  view.setUint32(0, userWord, true);
  view.setUint32(4, (~userWord) >>> 0, true);
  return bytes;
};
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
const reverseDifferencePlan = {
  ...differencePlan,
  source: differencePlan.target,
  target: differencePlan.source,
  verification: {
    ...differencePlan.verification,
    targetBundleSha256: STOCK_SHA,
    targetMainSha256: differencePlan.source.mainSha256,
  },
};
const safePreflightFailureAudit = () => ({
  outcome: "failed_or_uncertain",
  flashMode: "differences",
  routes: ["right", "left"],
  routeOrderSetupStops: [],
  supersededSuccessfulRouteResults: [],
  routeComponentRestartAttempts: [],
  routeComponentRestartResets: [],
  persistentDataRejectionStops: [],
  routeSetupResetStops: [],
  routeSetupResetResults: [],
  sourceValidation: {
    requiredLiveFirmware: "2.2.6.10",
  },
  routeResults: [
    {
      route: "right",
      outcome: "failed_or_uncertain",
      failureStage: "PREFLIGHT",
      otaMutationAttempted: false,
      acceptedFirmwareBytes: 0,
      preflightVersion: {
        firmware: "2.1.1.12",
        hardware: 5,
      },
      caseRestoreVerified: true,
      caseApplicationVersion: "1.2.57",
      retainedResult: {
        acceptedSize: 0,
        baselineMask: 0x3ff,
        selectedMask: 0x3ff,
        restoredMask: 0x3ff,
        templeUartErrors: 0,
      },
    },
  ],
  finalResetAndLiveness: {
    resetConfirmed: true,
    caseFirmware: "1.2.57",
    versions: {
      right: {
        firmware: "2.1.1.12",
        hardware: 5,
        yhmRestoreVerified: true,
      },
      left: {
        firmware: "2.1.1.12",
        hardware: 5,
        yhmRestoreVerified: true,
      },
    },
  },
});

test("defaults to Easy Mode, adaptive Update, and automatic Case repair", () => {
  assert.equal(DEFAULT_INTERFACE_MODE, "easy");
  assert.equal(DEFAULT_AUTOMATIC_INSTALL_MODE, "update");
  assert.equal(DEFAULT_AUTOMATIC_CASE_UPDATE, true);
});

test("blocks Automatic Apply before mutation when an analyzed Case is empty", () => {
  const empty = assessAutomaticTempleContacts({
    leftPresent: false,
    rightPresent: false,
  });
  assert.equal(empty.state, "neither-detected");
  assert.equal(empty.automaticApplyAllowed, false);
  assert.equal(empty.resetRecoveryEligible, false);
  assert.match(empty.reason, /No Case update or Smart Glasses transfer/);

  const partial = assessAutomaticTempleContacts({
    leftPresent: false,
    rightPresent: true,
  });
  assert.equal(partial.state, "partial-contact");
  assert.equal(partial.automaticApplyAllowed, true);
  assert.equal(partial.resetRecoveryEligible, true);

  const complete = assessAutomaticTempleContacts({
    leftPresent: true,
    rightPresent: true,
  });
  assert.equal(complete.state, "both-detected");
  assert.equal(complete.automaticApplyAllowed, true);
  assert.equal(complete.resetRecoveryEligible, false);

  assert.equal(
    assessAutomaticTempleContacts(null).automaticApplyAllowed,
    false,
  );
});

test("uses the factory identifier when a boot serial was not captured", () => {
  assert.equal(
    installedProvenanceStorageKey(null, "a5 26 03 26 00 00 07 80"),
    "sybilsight:g2-installed-provenance:factory-A526032600000780",
  );
  assert.equal(
    installedProvenanceStorageKey(
      "00500041514250052037384b",
      "a5 26 03 26 00 00 07 80",
    ),
    "sybilsight:g2-installed-provenance:00500041514250052037384b",
  );
  assert.equal(installedProvenanceStorageKey(null, null), null);
  assert.equal(
    installedProvenanceStorageKey(null, "FF FF FF FF FF FF FF FF"),
    null,
  );
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

test("automatic Case update refuses to erase when the preserved active vector is invalid", async () => {
  let stageCalled = false;
  await assert.rejects(
    () =>
      executeAutomaticCaseUpdate({
        session: {
          stageCaseImage: async () => {
            stageCalled = true;
          },
        },
        currentReport: {
          optionBytes: caseOptionBytes(false),
          options: {
            rdp: 0xaa,
            dualBank: true,
            swapBank: false,
            activePhysicalBank: 2,
            inactivePhysicalBank: 1,
          },
          banks: {
            active: {
              physicalBank: 2,
              version: "1.2.56",
              vectorValid: false,
            },
            inactive: {
              physicalBank: 1,
              version: "1.2.54",
              vectorValid: true,
            },
          },
        },
        targetFirmware: {
          caseRecoveryEligible: true,
          caseVersion: "1.2.57",
          caseImage: new Uint8Array([1]),
        },
      }),
    /active vector/,
  );
  assert.equal(stageCalled, false);
});

test("automatic Case update stages, activates, and re-analyzes before returning", async () => {
  const events = [];
  const optionBytes = caseOptionBytes(false);
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
      rdp: 0xaa,
      dualBank: true,
      swapBank: false,
      activePhysicalBank: 2,
      inactivePhysicalBank: 1,
    },
    banks: {
      active: {
        physicalBank: 2,
        version: "1.2.56",
        vectorValid: true,
      },
      inactive: {
        physicalBank: 1,
        version: "1.2.54",
        vectorValid: true,
      },
    },
  };
  const updatedReport = {
    optionBytes: caseOptionBytes(true),
    console: { caseVersion: "1.2.57" },
    options: {
      rdp: 0xaa,
      dualBank: true,
      swapBank: true,
      activePhysicalBank: 1,
      inactivePhysicalBank: 2,
    },
    banks: {
      active: {
        physicalBank: 1,
        version: "1.2.57",
        vectorValid: true,
      },
      inactive: {
        physicalBank: 2,
        version: "1.2.56",
        vectorValid: true,
      },
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
  assert.deepEqual(result.readiness, {
    verified: true,
    expectedVersion: "1.2.57",
    activePhysicalBank: 1,
    fallbackPhysicalBank: 2,
    activeVersion: "1.2.57",
    fallbackVersion: "1.2.56",
    swapBank: true,
  });
});

test("current Case readiness requires fresh options and valid active and fallback banks", () => {
  const report = {
    optionBytes: caseOptionBytes(true),
    console: { caseVersion: "1.2.57" },
    options: {
      rdp: 0xaa,
      dualBank: true,
      swapBank: true,
      activePhysicalBank: 1,
      inactivePhysicalBank: 2,
    },
    banks: {
      active: {
        physicalBank: 1,
        version: "1.2.57",
        vectorValid: true,
      },
      inactive: {
        physicalBank: 2,
        version: "1.2.56",
        vectorValid: true,
      },
    },
  };

  assert.equal(
    verifyAutomaticCaseReadiness(report, "1.2.57").verified,
    true,
  );
  assert.throws(
    () =>
      verifyAutomaticCaseReadiness(
        {
          ...report,
          banks: {
            ...report.banks,
            inactive: { ...report.banks.inactive, vectorValid: false },
          },
        },
        "1.2.57",
    ),
    /fallback physical bank 2 does not contain a valid vector table/,
  );
  assert.throws(
    () =>
      verifyAutomaticCaseReadiness(
        { ...report, optionBytes: caseOptionBytes(false) },
        "1.2.57",
      ),
    /decoded option snapshot and reported bank mode disagree/,
  );
});

test("automatic Case update rejects 1.2.57 when the staged bank was not activated", async () => {
  const optionBytes = caseOptionBytes(false);
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
            rdp: 0xaa,
            dualBank: true,
            swapBank: false,
            activePhysicalBank: 2,
            inactivePhysicalBank: 1,
          },
          banks: {
            active: {
              physicalBank: 2,
              version: "1.2.56",
              vectorValid: true,
            },
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
  const optionBytes = caseOptionBytes(false);
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
            rdp: 0xaa,
            dualBank: true,
            swapBank: false,
            activePhysicalBank: 2,
            inactivePhysicalBank: 1,
          },
          banks: {
            active: {
              physicalBank: 2,
              version: "1.2.56",
              vectorValid: true,
            },
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
    observedTempleVersions: observedBoth("2.2.6.10"),
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

test("Update falls back to a complete main when the difference proof is unsafe", () => {
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
  assert.equal(result.executable, true);
  assert.equal(result.flashMode, "complete");
  assert.match(result.reason, /complete pinned target Apollo main/i);
});

test("Update falls back to a complete main when no differential pair exists", () => {
  const result = resolveAutomaticApplyPlan({
    installMode: "update",
    targetFirmware: firmware(CFW_SHA),
    installedProvenance: {},
    observedTempleVersions: observedBoth("2.1.1.12"),
  });
  assert.equal(result.executable, true);
  assert.equal(result.flashMode, "complete");
  assert.equal(result.sourceProofMode, "complete-target-main");
  assert.match(result.reason, /complete pinned target Apollo main/i);
});

test("Update falls back to a complete main for proof outside the reviewed pair", () => {
  const result = resolveAutomaticApplyPlan({
    installMode: "update",
    targetFirmware: firmware(CFW_SHA),
    installedProvenance: both("e".repeat(64)),
    differenceSourceFirmware: firmware(STOCK_SHA),
    differencePlan,
  });
  assert.equal(result.executable, true);
  assert.equal(result.flashMode, "complete");
  assert.match(result.reason, /outside the exact reviewed/i);
});

test("Update uses a complete main from 2.1.1.12 instead of the Stock-CFW differential", () => {
  const result = resolveAutomaticApplyPlan({
    installMode: "update",
    targetFirmware: firmware(STOCK_SHA),
    installedProvenance: {},
    differenceSourceFirmware: firmware(CFW_SHA),
    differencePlan: reverseDifferencePlan,
    observedTempleVersions: observedBoth("2.1.1.12"),
  });
  assert.equal(result.executable, true);
  assert.equal(result.flashMode, "complete");
  assert.equal(result.sourceProofMode, "complete-target-main");
  assert.match(result.reason, /2\.1\.1\.12.*complete pinned target Apollo main/i);
});

test("fresh 2.1.1.12 identity overrides stale saved Stock differential proof", () => {
  const result = resolveAutomaticApplyPlan({
    installMode: "update",
    targetFirmware: firmware(CFW_SHA),
    installedProvenance: both(STOCK_SHA),
    differenceSourceFirmware: firmware(STOCK_SHA),
    differencePlan,
    observedTempleVersions: observedBoth("2.1.1.12"),
  });
  assert.equal(result.flashMode, "complete");
  assert.equal(result.sourceProofMode, "complete-target-main");
  assert.match(result.reason, /2\.1\.1\.12.*complete pinned target Apollo main/i);
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

test("fresh temple identity overrides stale saved target provenance", () => {
  const result = resolveAutomaticApplyPlan({
    installMode: "update",
    targetFirmware: {
      ...firmware(CFW_SHA),
      g2Version: "2.2.6.11",
    },
    installedProvenance: both(CFW_SHA),
    observedTempleVersions: observedBoth("2.1.1.12"),
  });
  assert.equal(result.action, "flash");
  assert.equal(result.flashMode, "complete");
  assert.match(result.reason, /contradicts the saved target audit/);
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

test("differential fallback requires proof that preflight changed no firmware bytes", () => {
  const plan = {
    flashMode: "differences",
    sourceVersion: "2.2.6.10",
  };
  const error = Object.assign(new Error("source mismatch"), {
    audit: safePreflightFailureAudit(),
  });
  assert.equal(canFallbackDifferentialToComplete(error, plan), true);

  error.audit.routeResults[0].acceptedFirmwareBytes = 1;
  assert.equal(canFallbackDifferentialToComplete(error, plan), false);

  error.audit = safePreflightFailureAudit();
  error.audit.finalResetAndLiveness.resetConfirmed = false;
  assert.equal(canFallbackDifferentialToComplete(error, plan), false);

  error.audit = safePreflightFailureAudit();
  error.audit.routeComponentRestartAttempts.push({
    acceptedFirmwareBytes: 1000,
  });
  assert.equal(canFallbackDifferentialToComplete(error, plan), false);
});

test("automatic Update safely retries a stale differential plan with the complete main", async () => {
  const calls = [];
  const recoveries = [];
  const successfulAudit = { outcome: "success" };
  const source = firmware(STOCK_SHA);
  const result = await executeAutomaticApply({
    session: {
      flashPinnedTempleMain: async (...args) => {
        calls.push(args);
        if (calls.length === 1) {
          throw Object.assign(new Error("live source mismatch"), {
            audit: safePreflightFailureAudit(),
          });
        }
        return successfulAudit;
      },
    },
    installMode: "update",
    targetFirmware: firmware(CFW_SHA),
    installedProvenance: both(STOCK_SHA),
    differenceSourceFirmware: source,
    differencePlan,
    onRecovery: (recovery) => recoveries.push(recovery),
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0][2].mode, "differences");
  assert.deepEqual(calls[1], [
    firmware(CFW_SHA),
    "both",
    { mode: "complete", differenceSourceFirmware: null },
  ]);
  assert.equal(result.initialPlan.flashMode, "differences");
  assert.equal(result.plan.flashMode, "complete");
  assert.equal(
    result.audit.automaticFallback.kind,
    "differential-to-complete",
  );
  assert.equal(recoveries[0].observedVersion, "2.1.1.12");
});

test("automatic Update invokes a complete bilateral session for 2.1.1.12", async () => {
  const calls = [];
  await executeAutomaticApply({
    session: {
      flashPinnedTempleMain: async (...args) => {
        calls.push(args);
        return { outcome: "success" };
      },
    },
    installMode: "update",
    targetFirmware: firmware(STOCK_SHA),
    installedProvenance: {},
    differenceSourceFirmware: firmware(CFW_SHA),
    differencePlan: reverseDifferencePlan,
    observedTempleVersions: observedBoth("2.1.1.12"),
  });
  assert.deepEqual(calls, [
    [
      firmware(STOCK_SHA),
      "both",
      { mode: "complete", differenceSourceFirmware: null },
    ],
  ]);
});

test("automatic Update already at target performs reset-only verification", async () => {
  let resetCalls = 0;
  let resetOptions = null;
  const result = await executeAutomaticApply({
    session: {
      restartAndVerifyBothTemples: async (options) => {
        resetCalls += 1;
        resetOptions = options;
        return { applicationLivenessVerified: true };
      },
    },
    installMode: "update",
    targetFirmware: {
      ...firmware(CFW_SHA),
      g2Version: "2.2.6.11",
    },
    installedProvenance: both(CFW_SHA),
  });
  assert.equal(resetCalls, 1);
  assert.equal(resetOptions.expectedVersion, "2.2.6.11");
  assert.equal(result.action, "verify-only");
  assert.equal(result.result.applicationLivenessVerified, true);
});

test("automatic Update reuses the fresh matching preflight instead of resetting twice", async () => {
  const readiness = {
    applicationLivenessVerified: true,
    firmwareBytesTransmitted: 0,
    caseVersion: "1.2.57",
    telemetry: { leftPresent: true, rightPresent: true },
    versions: {
      right: {
        firmware: "2.2.6.11",
        hardware: 5,
        yhmRestoreVerified: true,
      },
      left: {
        firmware: "2.2.6.11",
        hardware: 5,
        yhmRestoreVerified: true,
      },
    },
  };
  const result = await executeAutomaticApply({
    session: {
      restartAndVerifyBothTemples: async () => {
        throw new Error("must not issue a second reset");
      },
    },
    installMode: "update",
    targetFirmware: {
      ...firmware(CFW_SHA),
      g2Version: "2.2.6.11",
    },
    installedProvenance: both(CFW_SHA),
    observedTempleVersions: observedBoth("2.2.6.11"),
    verifiedTempleReadiness: readiness,
  });

  assert.equal(result.action, "verify-only");
  assert.equal(result.result, readiness);
});
