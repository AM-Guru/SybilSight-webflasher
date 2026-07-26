export const DEFAULT_INTERFACE_MODE = "easy";
export const DEFAULT_AUTOMATIC_INSTALL_MODE = "update";
export const AUTOMATIC_INSTALL_MODES = Object.freeze(["update", "restore"]);

const ROUTES = Object.freeze(["right", "left"]);
const REVIEWED_DIFFERENCE_VERSION = "2.2.6.10";
const MAIN_COMPONENT = "ota/s200_firmware_ota.bin";

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
      source?.version === REVIEWED_DIFFERENCE_VERSION &&
      target?.version === REVIEWED_DIFFERENCE_VERSION &&
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
        "Update stopped before writing: without portable source audits, live validation is allowed only for the exact reviewed Stock 2.2.6.10 ↔ CFW pair when the complete pinned target main is transferred.",
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
      : "No portable source audit is available. The exact reviewed pair transfers the complete pinned target main, so each temple will instead require a just-in-time checksum-valid 2.2.6.10/hardware-5 reply before START.",
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
