export const DEFAULT_INTERFACE_MODE = "easy";
export const DEFAULT_AUTOMATIC_INSTALL_MODE = "update";
export const AUTOMATIC_INSTALL_MODES = Object.freeze(["update", "restore"]);

const ROUTES = Object.freeze(["right", "left"]);

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
  if (!bothRoutesMatch(installedProvenance, sourceSha256)) {
    return {
      executable: false,
      reason:
        "Update stopped before writing: both temples must have a prior successful audit proving the displayed source image. Version 2.2.6.10 alone cannot distinguish Stock from CFW.",
    };
  }

  return {
    executable: true,
    action: "flash",
    route: "both",
    flashMode: "differences",
    sourceSha256,
    targetSha256,
    reason:
      "Skip byte-identical bundle components and transfer the one changed, CRC-gated Apollo main to both temples.",
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
      {
        mode: plan.flashMode,
        differenceSourceFirmware:
          plan.flashMode === "differences"
            ? differenceSourceFirmware
            : null,
      },
    ),
  };
}

export function installedProvenanceStorageKey(caseSerial) {
  const serial = String(caseSerial ?? "").trim();
  return serial ? `sybilsight:g2-installed-provenance:${serial}` : null;
}
