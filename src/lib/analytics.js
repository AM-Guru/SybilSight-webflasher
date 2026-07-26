import {
  POGO_TRANSFER_RESEARCH,
  bytesToBase64,
  hex,
  hexBytes,
} from "./firmware.js";
import {
  REVIEWED_CASE_VERSION,
  REVIEWED_CFW_BASE_VERSION,
  REVIEWED_CFW_VERSION,
} from "./pogoFlashBridge.js";

export const DEVICE_ANALYTICS_SCHEMA_VERSION = 1;

const FACTORY_QUERIES = Object.freeze([
  Object.freeze({ command: "DEA0", scope: "case", data: "case firmware banner and serial" }),
  Object.freeze({ command: "DEA2", scope: "case", data: "factory identifier" }),
  Object.freeze({ command: "DEA3", scope: "case+glasses", data: "case power, lid, and left/right presence telemetry" }),
  Object.freeze({ command: "DEA4", scope: "case", data: "scalar factory state" }),
]);

function serializeProof(proof) {
  if (!proof) return null;
  return {
    baselineMask: hex(proof.baselineMask),
    selectedMask: hex(proof.selectedMask),
    restoredMask: hex(proof.restoredMask),
    writeMask: hex(proof.writeMask),
    transmittedBytes: proof.transmitted,
    capturedBytes: proof.stored,
    uartErrorMask: hex(proof.errors),
    baselineYhmRegistersHex: hexBytes(proof.baseline),
  };
}

function serializeProbe(probe) {
  if (!probe) return null;
  return {
    operation: probe.operation,
    route: probe.route,
    observedAt: probe.observedAt ?? null,
    decoded: { ...probe.decoded },
    capturedFrameHex: hexBytes(probe.captured),
    capturedFrameBase64: bytesToBase64(probe.captured),
    transportProof: serializeProof(probe.transportProof),
  };
}

function templeAnalytics(side, present, results) {
  const version = serializeProbe(results?.version);
  const status = serializeProbe(results?.status);
  const firmwareVersion = version?.decoded?.firmwareVersion ?? null;
  const hardwareRevision = version?.decoded?.hardwareRevision ?? null;
  const applicationResponsive = Boolean(version || status);
  const reviewedWriterCompatible =
    [REVIEWED_CFW_BASE_VERSION, REVIEWED_CFW_VERSION].includes(
      firmwareVersion,
    ) && hardwareRevision === 5;
  return {
    side,
    present: Boolean(present),
    applicationResponsive,
    firmwareVersion,
    hardwareRevision,
    batteryPercent: status?.decoded?.batteryPercent ?? null,
    voltageMv: status?.decoded?.voltageMv ?? null,
    reviewedWriterCompatible,
    version,
    status,
  };
}

function recoveryEvidence() {
  const bridge = POGO_TRANSFER_RESEARCH.caseUsbBridge;
  const successfulTransfers = Object.fromEntries(
    Object.entries(bridge.successfulTransfers).map(([side, value]) => [
      side,
      {
        route: value.route,
        imageSha256: value.imageSha256,
        mainPayloadSha256: value.mainPayloadSha256,
        payloadBytes: value.payloadBytes,
        acceptedBytes: value.acceptedBytes,
        recordsSent: value.recordsSent,
        expectedSequence: value.expectedSequence,
        dataRetries: value.dataRetries,
        finishAckReceived: value.finishAckReceived,
        preflightFirmware: value.preflightFirmware,
        postflightFirmware: value.postflightFirmware,
        hardware: value.hardware,
        templeTxCount: value.templeTxCount,
        templeRxCount: value.templeRxCount,
        baselineMask: value.baselineMask,
        selectedMask: value.selectedMask,
        restoredMask: value.restoredMask,
        baselineYhmRegistersHex: value.baseline,
        templeUartErrors: value.templeUartErrors,
        caseApplicationVersion: value.caseApplicationVersion,
        caseRestoreVerified: value.caseRestoreVerified,
      },
    ]),
  );
  return {
    asOf: POGO_TRANSFER_RESEARCH.asOf,
    status: bridge.status,
    attempts: bridge.attempts,
    validationBoundary: bridge.validationBoundary,
    attemptedBridgeSha256: [...bridge.attemptedBridgeSha256],
    currentBridgeDeclaredSha256: bridge.declaredSha256,
    currentBridgeSha256: bridge.observedSha256,
    currentBridgeBytes: bridge.observedBytes,
    currentSourceHardwareRuns: bridge.hardwareAttemptsWithCurrentSource,
    currentSourceSuccessfulHardwareRuns:
      bridge.successfulHardwareAttemptsWithCurrentSource,
    successfulTransfers,
    failureEvidence: {
      bestPartialTransfer: { ...bridge.bestPartialTransfer },
      failClosedAttempt: { ...bridge.failClosedAttempt },
      leftFailClosed: { ...bridge.leftFailClosed },
      leftPartialTransfer: { ...bridge.leftPartialTransfer },
    },
    allowlist: {
      component: POGO_TRANSFER_RESEARCH.directTempleHost.component,
      directHostOfflineTestsPassed:
        POGO_TRANSFER_RESEARCH.directTempleHost.offlineTestsPassed,
      startAndHeaderReplayAllowed:
        POGO_TRANSFER_RESEARCH.directTempleHost.startAndHeaderReplayAllowed,
      dataRetryOnly: POGO_TRANSFER_RESEARCH.directTempleHost.dataRetryOnly,
      dataRetryReasons: [
        ...POGO_TRANSFER_RESEARCH.directTempleHost.dataRetryReasons,
      ],
      deferredBatchSettleMs:
        POGO_TRANSFER_RESEARCH.directTempleHost.deferredBatchSettleMs,
      postflightVersionRequired:
        POGO_TRANSFER_RESEARCH.directTempleHost.postflightVersionRequired,
      bootloaderAllowed: false,
    },
  };
}

export function buildG2DeviceAnalytics({
  report,
  pogoResults = {},
  recoveryConfig = null,
  templeFlashAudit = null,
  generatedAt = new Date().toISOString(),
}) {
  if (!report) throw new Error("Analyze the G2 case before building analytics.");
  const telemetry = report.console?.telemetry;
  const left = templeAnalytics("left", telemetry?.leftPresent, pogoResults.left);
  const right = templeAnalytics("right", telemetry?.rightPresent, pogoResults.right);
  const caseVersion =
    report.console?.caseVersion ?? report.banks?.active?.version ?? null;
  const caseCompatible = caseVersion === REVIEWED_CASE_VERSION;
  const bothTemplesResponsive =
    left.applicationResponsive && right.applicationResponsive;
  const bothTemplesWriterCompatible =
    left.reviewedWriterCompatible && right.reviewedWriterCompatible;

  return {
    schemaVersion: DEVICE_ANALYTICS_SCHEMA_VERSION,
    reportKind: "even-realities-g2-case-and-smart-glasses-analytics",
    generatedAt,
    chargingCase: {
      scope: "charging-case MCU, USB bridge, factory console, banks, and option bytes",
      firmwareVersion: caseVersion,
      serialNumber: report.console?.serialNumber ?? null,
      factoryIdentifier: report.console?.identifier ?? null,
      telemetry: telemetry ? { ...telemetry } : null,
      usb: { ...report.usb },
      rom: {
        protocolVersion: report.rom?.protocolVersion ?? null,
        productId: report.rom?.productId ?? null,
        commands: [...(report.rom?.commands ?? [])],
      },
      options: report.options
        ? {
            rdp: hex(report.options.rdp, 2),
            dualBank: report.options.dualBank,
            swapBank: report.options.swapBank,
            activePhysicalBank: report.options.activePhysicalBank,
            inactivePhysicalBank: report.options.inactivePhysicalBank,
            userWord: hex(report.options.userWord),
            complement: hex(report.options.complement),
          }
        : null,
      banks: report.banks
        ? {
            active: { ...report.banks.active },
            inactive: { ...report.banks.inactive },
          }
        : null,
      shell: {
        transport: "Web Serial at 1,000,000 baud, 8N1",
        allowlistedQueries: FACTORY_QUERIES.map((query) => ({ ...query })),
        rawOutput: report.console?.text ?? "",
      },
    },
    smartGlasses: {
      scope: "left/right running Apollo applications reached through the case pogo routes",
      sourceBoundary:
        "The case reports presence; version, battery, voltage, and route proof come from the reviewed volatile SRAM bridge.",
      left,
      right,
      recoveryAssessment: {
        mode: "running-application Apollo-main reinstall through case USB",
        requiredCaseVersion: REVIEWED_CASE_VERSION,
        requiredTempleVersions: [
          REVIEWED_CFW_BASE_VERSION,
          REVIEWED_CFW_VERSION,
        ],
        requiredHardwareRevision: 5,
        caseCompatible,
        bothTemplesResponsive,
        bothTemplesWriterCompatible,
        bothRoutesReady:
          caseCompatible &&
          left.present &&
          right.present &&
          bothTemplesResponsive &&
          bothTemplesWriterCompatible,
        applicationDeadRecoveryAvailable: false,
        bootloaderWriteAllowed: false,
        limitation:
          "The validated path reinstalls only the reviewed Apollo main while each temple application and pogo UART task remain alive.",
      },
      offlineRecoveryProvisioning: recoveryConfig,
    },
    validatedRecoveryEvidence: recoveryEvidence(),
    sessionRecoveryAudit: templeFlashAudit,
  };
}
