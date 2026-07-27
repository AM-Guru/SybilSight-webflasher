export const DEFAULT_INTERFACE_MODE = "easy";
export const DEFAULT_AUTOMATIC_INSTALL_MODE = "update";
export const DEFAULT_AUTOMATIC_CASE_UPDATE = false;
export const AUTOMATIC_INSTALL_MODES = Object.freeze(["update", "restore"]);

const ROUTES = Object.freeze(["right", "left"]);
const REVIEWED_STOCK_VERSION = "2.2.6.10";
const REVIEWED_CFW_VERSION = "2.2.6.11";
const MAIN_COMPONENT = "ota/s200_firmware_ota.bin";

function compareVersions(left, right) {
  const parse = (version) => {
    const text = String(version ?? "").trim();
    if (!/^\d+(?:\.\d+)*$/.test(text)) return null;
    return text.split(".").map((part) => Number.parseInt(part, 10));
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  if (!leftParts || !rightParts) return null;
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function resolveAutomaticCaseUpdatePlan({
  enabled = DEFAULT_AUTOMATIC_CASE_UPDATE,
  currentVersion,
  targetRelease,
}) {
  const targetVersion = targetRelease?.caseVersion;
  if (
    targetRelease?.channel !== "official" ||
    targetRelease?.caseRecoveryEligible === false ||
    !targetVersion
  ) {
    return {
      executable: false,
      action: "blocked",
      reason:
        "The firmware library does not contain a verified official Charging Case update.",
    };
  }

  const comparison = compareVersions(currentVersion, targetVersion);
  if (comparison == null) {
    return {
      executable: false,
      action: "blocked",
      reason:
        `Automatic Apply cannot safely compare Case firmware ${currentVersion ?? "unknown"} with ${targetVersion}.`,
    };
  }
  if (comparison === 0) {
    return {
      executable: true,
      action: "none",
      currentVersion,
      targetVersion,
      reason: `The Charging Case already runs the latest firmware ${targetVersion}.`,
    };
  }
  if (comparison > 0) {
    return {
      executable: false,
      action: "blocked",
      currentVersion,
      targetVersion,
      reason:
        `The Charging Case reports ${currentVersion}, newer than library version ${targetVersion}; Automatic Apply will not downgrade it.`,
    };
  }
  if (!enabled) {
    return {
      executable: false,
      action: "blocked",
      currentVersion,
      targetVersion,
      reason:
        `Automatic Smart Glasses recovery requires Case ${targetVersion}; found ${currentVersion}. Enable “Update Charging Case first” and Apply again.`,
    };
  }
  return {
    executable: true,
    action: "update",
    currentVersion,
    targetVersion,
    reason:
      `Update the Charging Case from ${currentVersion} to ${targetVersion}, verify the new active bank, then continue with Smart Glasses recovery.`,
  };
}

function requirePhysicalBank(value, label) {
  if (value !== 1 && value !== 2) {
    throw new Error(
      `Charging Case bank switch verification is missing ${label}. Smart Glasses flashing was not started.`,
    );
  }
  return value;
}

function verifyPreUpdateBankMapping(report) {
  const activePhysicalBank = requirePhysicalBank(
    report?.options?.activePhysicalBank,
    "the pre-update active physical bank",
  );
  const inactivePhysicalBank = requirePhysicalBank(
    report?.options?.inactivePhysicalBank,
    "the pre-update inactive physical bank",
  );
  if (
    activePhysicalBank === inactivePhysicalBank ||
    typeof report?.options?.swapBank !== "boolean" ||
    report?.banks?.active?.physicalBank !== activePhysicalBank ||
    report?.banks?.inactive?.physicalBank !== inactivePhysicalBank ||
    !report?.banks?.active?.version
  ) {
    throw new Error(
      "The pre-update Charging Case option bytes and physical-bank mapping are incomplete or inconsistent. Analyze the Case again before updating it.",
    );
  }
}

export function verifyAutomaticCaseBankSwitch({
  beforeReport,
  afterReport,
  targetVersion,
}) {
  const previousActivePhysicalBank = requirePhysicalBank(
    beforeReport?.options?.activePhysicalBank,
    "the pre-update active physical bank",
  );
  const stagedPhysicalBank = requirePhysicalBank(
    beforeReport?.options?.inactivePhysicalBank,
    "the pre-update inactive physical bank",
  );
  const activePhysicalBank = requirePhysicalBank(
    afterReport?.options?.activePhysicalBank,
    "the post-update active physical bank",
  );
  const fallbackPhysicalBank = requirePhysicalBank(
    afterReport?.options?.inactivePhysicalBank,
    "the post-update inactive physical bank",
  );
  const previousSwapBank = beforeReport?.options?.swapBank;
  const activeSwapBank = afterReport?.options?.swapBank;
  const previousActiveVersion = beforeReport?.banks?.active?.version;
  const fallbackVersion = afterReport?.banks?.inactive?.version;

  const failures = [];
  if (previousActivePhysicalBank === stagedPhysicalBank) {
    failures.push("the pre-update bank mapping is invalid");
  }
  if (
    beforeReport?.banks?.active?.physicalBank !== previousActivePhysicalBank ||
    beforeReport?.banks?.inactive?.physicalBank !== stagedPhysicalBank
  ) {
    failures.push("the pre-update option bytes and bank aliases disagree");
  }
  if (
    typeof previousSwapBank !== "boolean" ||
    typeof activeSwapBank !== "boolean" ||
    previousSwapBank === activeSwapBank
  ) {
    failures.push("the nSWAP_BANK option did not toggle");
  }
  if (
    activePhysicalBank !== stagedPhysicalBank ||
    fallbackPhysicalBank !== previousActivePhysicalBank
  ) {
    failures.push(
      `physical bank ${stagedPhysicalBank} did not become active while physical bank ${previousActivePhysicalBank} became the fallback`,
    );
  }
  if (
    afterReport?.banks?.active?.physicalBank !== activePhysicalBank ||
    afterReport?.banks?.inactive?.physicalBank !== fallbackPhysicalBank
  ) {
    failures.push("the post-update option bytes and bank aliases disagree");
  }
  if (afterReport?.banks?.active?.version !== targetVersion) {
    failures.push(
      `active physical bank ${activePhysicalBank} reports ${afterReport?.banks?.active?.version ?? "an unknown version"}, expected ${targetVersion}`,
    );
  }
  if (
    !previousActiveVersion ||
    fallbackVersion !== previousActiveVersion
  ) {
    failures.push(
      `the fallback bank reports ${fallbackVersion ?? "an unknown version"}, expected the preserved pre-update version ${previousActiveVersion ?? "unknown"}`,
    );
  }

  if (failures.length) {
    throw new Error(
      `Charging Case bank switch was not confirmed after staging ${targetVersion}: ${failures.join("; ")}. Smart Glasses flashing was not started.`,
    );
  }

  return {
    verified: true,
    targetVersion,
    previousActiveVersion,
    fallbackVersion,
    previousActivePhysicalBank,
    stagedPhysicalBank,
    activePhysicalBank,
    fallbackPhysicalBank,
    previousSwapBank,
    activeSwapBank,
  };
}

export async function executeAutomaticCaseUpdate({
  session,
  currentReport,
  targetFirmware,
  onStep,
}) {
  if (!session) throw new Error("An analyzed G2 Case session is required.");
  if (
    !targetFirmware?.caseRecoveryEligible ||
    !(targetFirmware.caseImage instanceof Uint8Array) ||
    !targetFirmware.caseImage.length ||
    !targetFirmware.caseVersion
  ) {
    throw new Error(
      "The automatic Case update requires a validated official Case recovery image.",
    );
  }
  if (!(currentReport?.optionBytes instanceof Uint8Array)) {
    throw new Error(
      "Fresh Case option bytes are required before an automatic Case update.",
    );
  }
  verifyPreUpdateBankMapping(currentReport);

  await onStep?.("stage", targetFirmware);
  const staged = await session.stageCaseImage(
    targetFirmware.caseImage,
    currentReport.optionBytes,
    { progressBase: 0.04, progressSpan: 0.22 },
  );
  await onStep?.("activate", targetFirmware);
  const activation = await session.activateStagedBank(
    targetFirmware.caseImage,
    currentReport.optionBytes,
    { progressBase: 0.26, progressSpan: 0.1 },
  );
  if (activation?.caseVersion !== targetFirmware.caseVersion) {
    throw new Error(
      `The Charging Case restarted on ${activation?.caseVersion ?? "an unknown version"}, expected ${targetFirmware.caseVersion}.`,
    );
  }

  await onStep?.("reanalyze", targetFirmware);
  const report = await session.analyze({
    progressBase: 0.36,
    progressSpan: 0.12,
  });
  if (
    report?.console?.caseVersion !== targetFirmware.caseVersion ||
    report?.banks?.active?.version !== targetFirmware.caseVersion
  ) {
    throw new Error(
      `The Charging Case update was not proven in both the application and active bank (expected ${targetFirmware.caseVersion}).`,
    );
  }

  await onStep?.("verify-bank-switch", targetFirmware);
  const bankSwitch = verifyAutomaticCaseBankSwitch({
    beforeReport: currentReport,
    afterReport: report,
    targetVersion: targetFirmware.caseVersion,
  });

  await onStep?.("confirm", targetFirmware);
  const confirmation = await session.confirmCaseFirmwareVersion(
    targetFirmware.caseVersion,
  );
  if (confirmation?.confirmedVersion !== targetFirmware.caseVersion) {
    throw new Error(
      `The fresh Case firmware confirmation returned ${confirmation?.confirmedVersion ?? "unknown"}, expected ${targetFirmware.caseVersion}.`,
    );
  }
  return { staged, activation, report, bankSwitch, confirmation };
}

function auditVerificationComplete(audit) {
  const verification = audit?.verification;
  return Boolean(
    audit?.outcome === "success" &&
      verification?.everyRouteAcceptedExactTargetBytes &&
      verification?.everyRoutePostflightVersionValid &&
      verification?.finalDualTempleResetVerified &&
      verification?.postResetLivenessVerified,
  );
}

export function provenanceFromSuccessfulAudit(audit) {
  if (
    !auditVerificationComplete(audit) ||
    !/^[0-9a-f]{64}$/i.test(audit?.imageSha256 ?? "") ||
    !Array.isArray(audit?.routes)
  ) {
    return {};
  }
  return Object.fromEntries(
    audit.routes
      .filter((route) => ROUTES.includes(route))
      .map((route) => [
        route,
        {
          imageSha256: audit.imageSha256.toLowerCase(),
          channel: audit.installedIdentity?.channel ?? "unknown",
          reportedVersion: audit.installedIdentity?.reportedVersion ?? null,
          displayVersion: audit.installedIdentity?.displayVersion ?? null,
          provenAt: audit.finishedAt ?? new Date().toISOString(),
          proof: "verified-recovery-audit",
        },
      ]),
  );
}

export function mergeInstalledProvenance(current, audit) {
  const next = { ...(current ?? {}) };
  const affectedRoutes = Array.isArray(audit?.routes)
    ? audit.routes.filter((route) => ROUTES.includes(route))
    : [];

  if (audit?.outcome !== "success") {
    for (const route of affectedRoutes) delete next[route];
    return next;
  }
  return { ...next, ...provenanceFromSuccessfulAudit(audit) };
}

function bothRoutesMatch(provenance, imageSha256) {
  const normalized = String(imageSha256 ?? "").toLowerCase();
  return Boolean(
    normalized &&
      ROUTES.every(
        (route) =>
          provenance?.[route]?.imageSha256?.toLowerCase() === normalized,
      ),
  );
}

function knownRouteProofsBelongToPair(
  provenance,
  sourceSha256,
  targetSha256,
) {
  const pair = new Set([sourceSha256, targetSha256].map((value) =>
    String(value ?? "").toLowerCase(),
  ));
  return ROUTES.every((route) => {
    const known = provenance?.[route]?.imageSha256?.toLowerCase();
    return !known || pair.has(known);
  });
}

function supportsLiveCompatiblePairProof(differencePlan) {
  const source = differencePlan?.source;
  const target = differencePlan?.target;
  const wireTransfer = differencePlan?.wireTransfer;
  const verification = differencePlan?.verification;
  return Boolean(
    differencePlan?.executable &&
      differencePlan?.changedMainOnly === true &&
      new Set([source?.version, target?.version]).size === 2 &&
      [source?.version, target?.version].every((version) =>
        [REVIEWED_STOCK_VERSION, REVIEWED_CFW_VERSION].includes(version),
      ) &&
      wireTransfer?.component === MAIN_COMPONENT &&
      Number.isInteger(wireTransfer?.bytes) &&
      wireTransfer.bytes > 0 &&
      wireTransfer?.sparseByteRangesSupported === false &&
      verification?.targetBundleSha256?.toLowerCase() ===
        target?.imageSha256?.toLowerCase() &&
      verification?.targetMainSha256?.toLowerCase() ===
        target?.mainSha256?.toLowerCase() &&
      verification?.targetMainBytes === wireTransfer.bytes &&
      verification?.finishAcknowledgementRequired === true &&
      verification?.postResetLivenessRequired === true &&
      verification?.finalDualTempleResetRequired === true,
  );
}

export function resolveAutomaticApplyPlan({
  installMode = DEFAULT_AUTOMATIC_INSTALL_MODE,
  targetFirmware,
  installedProvenance,
  differenceSourceFirmware,
  differencePlan,
}) {
  if (!AUTOMATIC_INSTALL_MODES.includes(installMode)) {
    return {
      executable: false,
      reason: `Unknown install mode: ${installMode}.`,
    };
  }
  if (!targetFirmware?.templeFlashEligible) {
    return {
      executable: false,
      reason:
        "Choose an exact, hash-pinned Stock or reviewed CFW Smart Glasses bundle.",
    };
  }

  const targetSha256 = targetFirmware.fileSha256?.toLowerCase();
  if (installMode === "restore") {
    return {
      executable: true,
      action: "flash",
      route: "both",
      flashMode: "complete",
      targetSha256,
      reason: "Rewrite the complete pinned Apollo main on both temples.",
    };
  }

  if (bothRoutesMatch(installedProvenance, targetSha256)) {
    return {
      executable: true,
      action: "verify-only",
      route: "both",
      flashMode: null,
      targetSha256,
      reason:
        "Both temples already have a verified audit for the selected target; reset and liveness verification are sufficient.",
    };
  }

  const sourceSha256 = differenceSourceFirmware?.fileSha256?.toLowerCase();
  if (
    !differencePlan?.executable ||
    !sourceSha256 ||
    differencePlan.source?.imageSha256?.toLowerCase() !== sourceSha256 ||
    differencePlan.target?.imageSha256?.toLowerCase() !== targetSha256
  ) {
    return {
      executable: false,
      reason:
        "Update is available only for a validated Stock ↔ CFW component-difference pair.",
    };
  }
  if (
    !knownRouteProofsBelongToPair(
      installedProvenance,
      sourceSha256,
      targetSha256,
    )
  ) {
    return {
      executable: false,
      reason:
        "Update stopped before writing: saved proof identifies firmware outside the exact reviewed Stock ↔ CFW pair. Use Restore to establish a known target.",
    };
  }

  const exactSourceProven = bothRoutesMatch(
    installedProvenance,
    sourceSha256,
  );
  if (!exactSourceProven && !supportsLiveCompatiblePairProof(differencePlan)) {
    return {
      executable: false,
      reason:
        "Update stopped before writing: without portable source audits, live validation is allowed only for the exact reviewed Stock 2.2.6.10 ↔ CFW 2.2.6.11 pair when the complete pinned target main is transferred.",
    };
  }

  return {
    executable: true,
    action: "flash",
    route: "both",
    flashMode: "differences",
    sourceProofMode: exactSourceProven
      ? "verified-source-audits"
      : "live-compatible-pair-preflight",
    sourceSha256,
    targetSha256,
    reason: exactSourceProven
      ? "Saved bilateral audits prove the exact source. Skip byte-identical bundle components and transfer the changed, CRC-gated Apollo main to both temples."
      : `No portable source audit is available. The exact reviewed pair transfers the complete pinned target main, so each temple will instead require a just-in-time checksum-valid ${differencePlan.source.version}/hardware-5 reply before START.`,
  };
}

export async function executeAutomaticApply({
  session,
  installMode,
  targetFirmware,
  installedProvenance,
  differenceSourceFirmware,
  differencePlan,
  onPlan,
}) {
  if (!session) throw new Error("An analyzed G2 Case session is required.");
  const plan = resolveAutomaticApplyPlan({
    installMode,
    targetFirmware,
    installedProvenance,
    differenceSourceFirmware,
    differencePlan,
  });
  if (!plan.executable) throw new Error(plan.reason);
  await onPlan?.(plan);

  if (plan.action === "verify-only") {
    return {
      plan,
      action: "verify-only",
      result: await session.restartAndVerifyBothTemples(),
    };
  }

  return {
    plan,
    action: "flash",
    audit: await session.flashPinnedTempleMain(
      targetFirmware,
      plan.route,
      plan.flashMode === "differences"
        ? {
            mode: plan.flashMode,
            differenceSourceFirmware,
            sourceProofMode: plan.sourceProofMode,
          }
        : {
            mode: plan.flashMode,
            differenceSourceFirmware: null,
          },
    ),
  };
}

export function installedProvenanceStorageKey(caseSerial) {
  const serial = String(caseSerial ?? "").trim();
  return serial ? `sybilsight:g2-installed-provenance:${serial}` : null;
}
