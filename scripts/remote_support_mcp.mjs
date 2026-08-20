#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { userInfo } from "node:os";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocket } from "ws";
import { z } from "zod/v4";

import {
  assessAutomaticTempleContacts,
  AUTOMATIC_INSTALL_MODES,
  DEFAULT_AUTOMATIC_INSTALL_MODE,
  executeAutomaticApply,
  executeAutomaticCaseUpdate,
  installedProvenanceStorageKey,
  mergeInstalledProvenance,
  prepareAutomaticTempleUpdate,
  resolveAutomaticCaseUpdatePlan,
  verifyAutomaticCaseReadiness,
} from "../src/lib/automaticRecovery.js";
import {
  buildG2SystemBackupArtifact,
  resolveGlassesRecoveryReleases,
  validateGlassesRecoveryBundle,
  validateSavedCaseBackup,
} from "../src/lib/backup.js";
import {
  buildBundleDifferencePlan,
  findStockCfwCounterpartRelease,
} from "../src/lib/differential.js";
import { parseFirmwareInput } from "../src/lib/firmware.js";
import { REVIEWED_CASE_VERSION } from "../src/lib/pogoFlashBridge.js";
import { findLatestCaseFirmwareRelease } from "../src/lib/recoveryDefaults.js";
import { RemoteG2CasePort } from "../src/lib/remoteSerial.js";
import {
  RemoteSupportConnection,
  remoteJsonValue,
} from "../src/lib/remoteSupport.js";
import { G2CaseSession } from "../src/lib/serial.js";

const DEFAULT_RELAY_URL =
  "wss://webflasher.sybilsight.com/remote-support/ws";
const KEYCHAIN_SERVICE = "SybilSight WebFlasher Remote Support";
const CATALOG_INDEX_PATH = "firmware-catalog.json";

let connection = null;
let remotePort = null;
let caseSession = null;
let caseReport = null;
let backupRecord = null;
let stagedCase = null;
let currentProgress = null;
let catalog = null;
let catalogSource = null;
const installedProvenanceByDevice = new Map();
const eventLog = [];

function record(message, tone = "info") {
  eventLog.push({
    time: new Date().toISOString(),
    tone,
    message: String(message),
  });
  if (eventLog.length > 1000) eventLog.splice(0, eventLog.length - 1000);
}

function operatorKey() {
  const configured = String(process.env.SUPPORT_OPERATOR_KEY ?? "").trim();
  if (configured) return configured;
  if (process.platform !== "darwin") {
    throw new Error(
      "Set SUPPORT_OPERATOR_KEY before starting the remote-support MCP server.",
    );
  }
  return execFileSync(
    "/usr/bin/security",
    [
      "find-generic-password",
      "-w",
      "-a",
      userInfo().username,
      "-s",
      KEYCHAIN_SERVICE,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

function textResult(value, isError = false) {
  return {
    content: [
      {
        type: "text",
        text:
          typeof value === "string"
            ? value
            : JSON.stringify(remoteJsonValue(value), null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

// One remote Case means one serial conversation at a time. Concurrent MCP
// tool calls otherwise interleave open/close on the shared port ("already
// open" / missing-streams failures observed 2026-07-28), so every tool runs
// through this per-process queue in arrival order.
let toolQueue = Promise.resolve();

function tool(handler) {
  return (input, extra) => {
    const run = toolQueue.then(async () => {
      try {
        return await handler(input, extra);
      } catch (error) {
        record(error instanceof Error ? error.message : String(error), "error");
        return textResult(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          true,
        );
      }
    });
    toolQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

function requireConnection() {
  if (!connection || !remotePort || !caseSession) {
    throw new Error("Join a customer's remote-support session first.");
  }
  return { connection, remotePort, caseSession };
}

function progressReporter(extra) {
  return (fraction, detail) => {
    currentProgress = {
      fraction,
      percent: Math.round(fraction * 100),
      detail,
      updatedAt: new Date().toISOString(),
    };
    record(`[${currentProgress.percent}%] ${detail}`);
    if (extra?._meta?.progressToken !== undefined) {
      void extra.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken: extra._meta.progressToken,
          progress: Math.round(fraction * 1000),
          total: 1000,
          message: detail,
        },
      });
    }
  };
}

async function replaceConnection({ code, relayUrl }) {
  await remotePort?.dispose();
  connection?.close();
  remotePort = null;
  caseSession = null;
  connection = null;
  caseReport = null;
  backupRecord = null;
  stagedCase = null;
  currentProgress = null;

  const support = new RemoteSupportConnection({
    url: relayUrl,
    WebSocketImpl: WebSocket,
    onMessage: (message) => {
      if (message.type === "peer") {
        record(
          `${message.role} ${message.online ? "connected" : "disconnected"}.`,
          message.online ? "success" : "warn",
        );
      }
      if (message.type === "event") {
        record(
          message.value?.message ?? `${message.event}: ${JSON.stringify(message.value)}`,
          message.value?.tone ?? "info",
        );
      }
    },
    onState: (state) => {
      if (state.status === "disconnected" || state.status === "error") {
        record(
          state.error ?? state.reason ?? `Relay ${state.status}.`,
          "error",
        );
      }
    },
  });
  await support.joinOperator({
    code,
    operatorKey: operatorKey(),
  });
  const port = new RemoteG2CasePort(support);
  connection = support;
  remotePort = port;
  caseSession = new G2CaseSession(port, {
    log: record,
  });
  record(`Joined remote-support session ${support.session.code}.`, "success");
  return support.session;
}

function updateSessionProgress(extra) {
  requireConnection();
  caseSession.progress = progressReporter(extra);
}

function catalogBaseUrl() {
  const configured = String(process.env.WEBFLASHER_CATALOG_URL ?? "").trim();
  if (configured) return configured.endsWith("/") ? configured : `${configured}/`;
  const relay = new URL(process.env.REMOTE_SUPPORT_URL ?? DEFAULT_RELAY_URL);
  relay.protocol = relay.protocol === "ws:" ? "http:" : "https:";
  relay.pathname = "/";
  relay.search = "";
  relay.hash = "";
  return relay.toString();
}

async function loadCatalog({ refresh = false } = {}) {
  if (catalog && !refresh) return catalog;
  const url = new URL(CATALOG_INDEX_PATH, catalogBaseUrl());
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `The firmware archive index at ${url} returned HTTP ${response.status}.`,
    );
  }
  const value = await response.json();
  const releases = Array.isArray(value.releases)
    ? value.releases.map((release) => ({
        ...release,
        id: release.id ?? `g2-official-${release.version}`,
        channel: release.channel ?? "official",
        caseRecoveryEligible: release.caseRecoveryEligible ?? true,
      }))
    : [];
  catalog = releases;
  catalogSource = {
    url: url.toString(),
    schemaVersion: value.schemaVersion ?? null,
    generatedAt: value.generatedAt ?? null,
    fetchedAt: new Date().toISOString(),
    releaseCount: releases.length,
  };
  record(
    `Firmware archive index loaded · ${releases.length} verified releases.`,
    "success",
  );
  return catalog;
}

async function requireCatalogRelease(releaseId) {
  const releases = await loadCatalog();
  const release = releases.find((item) => item.id === releaseId);
  if (!release) {
    throw new Error(
      `The firmware archive does not contain release ${releaseId}. Call list_firmware_catalog for valid ids.`,
    );
  }
  return release;
}

async function fetchCatalogReleaseBytes(release, label = "Firmware archive") {
  const base = catalogBaseUrl();
  const urls = [
    ...new Set(
      [release?.url, release?.sourceUrl]
        .filter(Boolean)
        .map((url) => new URL(url, base).toString()),
    ),
  ];
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
      lastError = new Error(`${url} returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `${label} could not be downloaded${lastError?.message ? `: ${lastError.message}` : "."}`,
  );
}

async function firmwareFromCatalogRelease(release) {
  const bytes = await fetchCatalogReleaseBytes(release);
  if (bytes.length !== release.size) {
    throw new Error("The mirrored firmware size does not match its catalog.");
  }
  const parsed = await parseFirmwareInput(bytes, release.fileName);
  if (parsed.fileSha256 !== release.sha256) {
    throw new Error("The mirrored firmware SHA-256 does not match its catalog.");
  }
  return {
    ...parsed,
    provenance: {
      ...parsed.provenance,
      channel: release.channel,
      trust: release.trust ?? parsed.provenance.trust,
      label:
        release.channel === "custom"
          ? `Smart Glasses CFW · stock ${release.baseVersion} base`
          : `Verified G2 ${release.version} · archived SHA-256`,
      capabilities:
        release.capabilities ?? parsed.provenance.capabilities ?? [],
    },
    caseRecoveryEligible:
      release.caseRecoveryEligible ?? parsed.caseRecoveryEligible,
    catalogRelease: release,
  };
}

async function resolveFirmwareInput({ firmwarePath, releaseId }) {
  if (Boolean(firmwarePath) === Boolean(releaseId)) {
    throw new Error(
      "Provide exactly one firmware source: a local firmwarePath or an archive releaseId.",
    );
  }
  if (firmwarePath) {
    const input = new Uint8Array(await readFile(resolve(firmwarePath)));
    return parseFirmwareInput(input, basename(firmwarePath));
  }
  return firmwareFromCatalogRelease(await requireCatalogRelease(releaseId));
}

function deviceProvenanceKey(report) {
  return installedProvenanceStorageKey(
    report?.console?.serialNumber,
    report?.console?.identifier,
  );
}

function deviceProvenance(report) {
  const key = deviceProvenanceKey(report);
  return (key && installedProvenanceByDevice.get(key)) ?? {};
}

function recordInstalledProvenance(report, audit) {
  const key = deviceProvenanceKey(report);
  if (!key || !audit) return;
  installedProvenanceByDevice.set(
    key,
    mergeInstalledProvenance(installedProvenanceByDevice.get(key), audit),
  );
}

async function prepareDifferenceSource(firmware) {
  const releases = await loadCatalog();
  const counterpart = findStockCfwCounterpartRelease(releases, firmware);
  if (!counterpart) {
    throw new Error(
      "Differential flashing is available only for an exact reviewed Stock ↔ compatible CFW pair.",
    );
  }
  const source = await firmwareFromCatalogRelease(counterpart);
  const plan = buildBundleDifferencePlan(source, firmware);
  if (!plan.executable) {
    throw new Error(
      "The Stock/CFW comparison is not an executable one-component difference.",
    );
  }
  record(
    `Difference plan ready · ${plan.unchangedComponentCount} identical components skipped · ${plan.changedComponentCount} changed component transferred.`,
    "success",
  );
  return { source, plan };
}

const server = new McpServer(
  {
    name: "sybilsight-webflasher-support",
    version: "0.3.0",
  },
  {
    capabilities: {
      logging: {},
    },
    instructions:
      "This server operates only the exact G2 Case USB serial interface selected and authorized in the customer's open WebFlasher session. Join a session before using hardware tools. Prefer analyze_case and read_temple before mutation. Case activation and Smart Glasses flashing are destructive hardware operations; require explicit technician intent, a fresh analysis, and a saved backup (backup_system preferred; backup_case when temples are not seated). automatic_apply mirrors the WebFlasher's Automatic Apply and manages the Case update, bilateral reset verification, and complete-or-differential transfer selection itself. The customer does not need to approve individual commands after starting the session.",
  },
);

server.registerTool(
  "join_remote_case",
  {
    description:
      "Join the one-time support code shown in the customer's WebFlasher and prepare its selected G2 Case serial interface.",
    inputSchema: {
      code: z.string().min(8).describe("Customer's one-time support code"),
      relayUrl: z
        .string()
        .url()
        .default(process.env.REMOTE_SUPPORT_URL ?? DEFAULT_RELAY_URL),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  tool(async ({ code, relayUrl }) =>
    textResult(await replaceConnection({ code, relayUrl })),
  ),
);

server.registerTool(
  "list_firmware_catalog",
  {
    description:
      "List the deployed WebFlasher's verified firmware archive so releases can be selected by id instead of a local file path.",
    inputSchema: {
      refresh: z
        .boolean()
        .default(false)
        .describe("Refetch the archive index instead of using the cached copy"),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  tool(async ({ refresh }) => {
    const releases = await loadCatalog({ refresh });
    return textResult({
      source: catalogSource,
      releases: releases.map((release) => ({
        id: release.id,
        channel: release.channel,
        trust: release.trust ?? null,
        version: release.version,
        baseVersion: release.baseVersion ?? null,
        caseVersion: release.caseVersion ?? null,
        recoveryTarget: release.recoveryTarget ?? null,
        caseRecoveryEligible: release.caseRecoveryEligible,
        fileName: release.fileName,
        size: release.size,
        sha256: release.sha256,
        capabilities: release.capabilities ?? [],
        notes: release.notes ?? null,
      })),
    });
  }),
);

server.registerTool(
  "analyze_case",
  {
    description:
      "Run the WebFlasher's read-only Case console and STM32 ROM analysis over the customer's remote serial interface.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  tool(async (_input, extra) => {
    updateSessionProgress(extra);
    currentProgress = null;
    caseReport = await caseSession.analyze();
    return textResult(caseReport);
  }),
);

server.registerTool(
  "read_temple",
  {
    description:
      "Read the firmware identity or application status of one seated, responsive Smart Glasses temple through the pinned Case bridge.",
    inputSchema: {
      route: z.enum(["left", "right"]),
      operation: z.enum(["version", "status"]),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  tool(async ({ route, operation }, extra) => {
    updateSessionProgress(extra);
    return textResult(
      await caseSession.probeRunningTemple(operation, route),
    );
  }),
);

server.registerTool(
  "reset_and_recheck_glasses",
  {
    description:
      "Issue the traced bilateral G2 temple reset through the selected Case, then verify reopened Case telemetry, both contacts, and checksum-valid left/right application liveness — the WebFlasher's full post-reset verification.",
    inputSchema: {
      expectedVersion: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Optional firmware version both temples must report after the reset",
        ),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  tool(async ({ expectedVersion }, extra) => {
    updateSessionProgress(extra);
    return textResult(
      await caseSession.restartAndVerifyBothTemples({
        expectedVersion: expectedVersion ?? null,
        progressBase: 0,
        progressSpan: 1,
        purpose: "Technician reset and recheck",
      }),
    );
  }),
);

server.registerTool(
  "backup_case",
  {
    description:
      "Read and save a verified 512 KiB Case flash and option-byte backup on the technician computer. Use backup_system for the combined Case + Smart Glasses backup when both temples are seated. Pass reuseSavedBackupPath to satisfy the flash gate from an existing hash-verified backup of this exact case instead of re-reading its flash — useful when a retry follows a recent backup over a slow link.",
    inputSchema: {
      outputPath: z
        .string()
        .min(1)
        .describe("Explicit local path for the private JSON backup"),
      reuseSavedBackupPath: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Existing backup_case JSON to revalidate and reuse instead of re-reading the 512 KiB case flash. The embedded bytes must match their recorded digests and the backup must name the currently analyzed case's serial.",
        ),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  tool(async ({ outputPath, reuseSavedBackupPath }, extra) => {
    updateSessionProgress(extra);
    if (reuseSavedBackupPath) {
      // Reuse is gated on the fresh analysis: the saved backup must name the
      // exact case this session selected, and its digests are recomputed from
      // the embedded bytes rather than trusted. This spares the multi-minute
      // flash re-read that every new technician process otherwise pays before
      // a retry, without weakening what the flash gate proves.
      if (!caseReport?.console?.serialNumber) {
        throw new Error(
          "Run analyze_case before reusing a saved backup so the case serial can be matched.",
        );
      }
      const savedPath = resolve(reuseSavedBackupPath);
      const artifact = JSON.parse(await readFile(savedPath, "utf8"));
      const verified = await validateSavedCaseBackup(artifact, {
        expectedSerial: caseReport.console.serialNumber,
      });
      backupRecord = {
        scope: "case-only-reused",
        outputPath: savedPath,
        flashSha256: verified.flashSha256,
        optionSha256: verified.optionSha256,
        serialNumber: verified.serialNumber,
      };
      record(
        `Reusing verified case backup ${savedPath} · digests recomputed from embedded bytes · serial ${verified.serialNumber} matches the analyzed case.`,
        "success",
      );
      return textResult(backupRecord);
    }
    const backup = await caseSession.backup();
    const resolvedPath = resolve(outputPath);
    await writeFile(
      resolvedPath,
      `${JSON.stringify({
        schemaVersion: 2,
        capturedAt: new Date().toISOString(),
        caseVersion: caseReport?.console?.caseVersion ?? null,
        serialNumber: caseReport?.console?.serialNumber ?? null,
        flashSha256: backup.flashSha256,
        optionSha256: backup.optionSha256,
        flashBase64: Buffer.from(backup.flash).toString("base64"),
        optionBytesBase64: Buffer.from(backup.optionBytes).toString("base64"),
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    backupRecord = {
      scope: "case-only",
      outputPath: resolvedPath,
      flashSha256: backup.flashSha256,
      optionSha256: backup.optionSha256,
      serialNumber: caseReport?.console?.serialNumber ?? null,
    };
    return textResult(backupRecord);
  }),
);

server.registerTool(
  "backup_system",
  {
    description:
      "Create the combined Case + Smart Glasses backup: full Case flash and option bytes, live left/right temple identity snapshots, and each route's matching validated archived recovery bundle (official preferred, reviewed channels accepted; split-version pairs record per-route bundles, and an unarchived version is recorded as an explicit omission). Requires a fresh analysis with both temples seated.",
    inputSchema: {
      outputPath: z
        .string()
        .min(1)
        .describe("Explicit local path for the private .g2-backup.json artifact"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  tool(async ({ outputPath }, extra) => {
    updateSessionProgress(extra);
    if (
      !caseReport?.console?.telemetry?.leftPresent ||
      !caseReport?.console?.telemetry?.rightPresent
    ) {
      throw new Error(
        "Seat both Smart Glasses temples in the Case, run analyze_case, and try the combined backup again.",
      );
    }
    const releases = await loadCatalog();
    // Resolve every cheap precondition before the expensive read. Each temple
    // probe costs seconds; the 512 KiB case flash read costs many minutes on a
    // slow or marginal link. Probing first turns an unsatisfiable combination
    // — temples on different versions, or a version with no archived official
    // bundle — into a fast failure instead of a long one whose result is then
    // discarded. caseSession.backup() restores the normal application in its
    // own finally block, so it remains safe as the last step.
    const templeProbes = {};
    for (const [index, route] of ["left", "right"].entries()) {
      templeProbes[route] = await caseSession.probeRunningTemple(
        "version",
        route,
        {
          progressBase: index * 0.14,
          progressSpan: 0.14,
        },
      );
    }
    // Per-route resolution: a split pair or a reviewed-CFW pair is backed up,
    // not refused — each route gets its exact-version archived bundle
    // (official preferred, any verified channel accepted), and a version with
    // no archived bundle is recorded as an explicit omission.
    const recoveryResolution = resolveGlassesRecoveryReleases(
      releases,
      templeProbes,
    );
    if (!recoveryResolution.pairMatched) {
      record(
        `The seated temples report different firmware versions (left ${recoveryResolution.left.version}, right ${recoveryResolution.right.version}); backing up both live snapshots with per-route recovery bundles.`,
        "warn",
      );
    }
    for (const side of ["left", "right"]) {
      const omission = recoveryResolution[side].omissionReason;
      if (omission) record(`${side}: ${omission}`, "warn");
    }
    const recoveryBundles = [];
    for (const release of recoveryResolution.releases) {
      const bytes = await fetchCatalogReleaseBytes(
        release,
        "Smart Glasses recovery archive",
      );
      await validateGlassesRecoveryBundle(bytes, release);
      recoveryBundles.push({ release, bytes });
    }
    const caseBackup = await caseSession.backup({
      progressBase: 0.28,
      progressSpan: 0.62,
    });
    const artifact = buildG2SystemBackupArtifact({
      caseBackup,
      report: caseReport,
      templeProbes,
      recoveryResolution,
      recoveryBundles,
    });
    const resolvedPath = resolve(outputPath);
    await writeFile(
      resolvedPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    backupRecord = {
      scope: "system",
      outputPath: resolvedPath,
      flashSha256: caseBackup.flashSha256,
      optionSha256: caseBackup.optionSha256,
      templeFirmware: {
        left: artifact.smartGlasses.left.firmwareVersion,
        right: artifact.smartGlasses.right.firmwareVersion,
      },
      pairMatched: recoveryResolution.pairMatched,
      recoveryBundles: artifact.smartGlasses.recoveryBundles.map(
        ({ coveredSides, version, channel, sha256 }) => ({
          coveredSides,
          version,
          channel,
          sha256,
        }),
      ),
      recoveryBundleOmissions: artifact.smartGlasses.recoveryBundleOmissions,
    };
    record(
      `Combined backup saved · full Case + temple snapshots (left ${recoveryResolution.left.version}, right ${recoveryResolution.right.version}) + ${artifact.smartGlasses.recoveryBundles.length} validated recovery bundle${artifact.smartGlasses.recoveryBundles.length === 1 ? "" : "s"}.`,
      "success",
    );
    return textResult(backupRecord);
  }),
);

server.registerTool(
  "stage_case_firmware",
  {
    description:
      "Erase, write, and byte-verify an eligible Case image in the inactive bank, from a local file or an archive releaseId. Requires a fresh analysis and saved backup.",
    inputSchema: {
      firmwarePath: z
        .string()
        .min(1)
        .optional()
        .describe("Local reviewed firmware package or Case image"),
      releaseId: z
        .string()
        .min(1)
        .optional()
        .describe("Verified firmware archive release id (see list_firmware_catalog)"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  tool(async ({ firmwarePath, releaseId }, extra) => {
    updateSessionProgress(extra);
    if (!caseReport?.optionBytes) {
      throw new Error("Run analyze_case immediately before staging.");
    }
    if (!backupRecord) {
      throw new Error(
        "Save a verified backup_system or backup_case before staging firmware.",
      );
    }
    const firmware = await resolveFirmwareInput({ firmwarePath, releaseId });
    if (!firmware.caseRecoveryEligible || !firmware.caseImage) {
      throw new Error("The selected input is not an eligible G2 Case image.");
    }
    const optionSnapshot = Uint8Array.from(caseReport.optionBytes);
    const result = await caseSession.stageCaseImage(
      firmware.caseImage,
      optionSnapshot,
    );
    stagedCase = {
      firmware,
      optionSnapshot,
      result,
    };
    return textResult({
      caseVersion: firmware.caseVersion,
      sourceSha256: result.sourceSha256,
      readbackSha256: result.readbackSha256,
      pageCount: result.pageCount,
      backup: backupRecord,
    });
  }),
);

server.registerTool(
  "activate_staged_case_firmware",
  {
    description:
      "Reverify and activate the exact Case image staged by this MCP process, then reset and recheck the hardware.",
    inputSchema: {},
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  tool(async (_input, extra) => {
    updateSessionProgress(extra);
    if (!stagedCase) {
      throw new Error(
        "No verified staged Case image exists in this technician session.",
      );
    }
    const result = await caseSession.activateStagedBank(
      stagedCase.firmware.caseImage,
      stagedCase.optionSnapshot,
    );
    stagedCase = null;
    caseReport = await caseSession.analyze();
    return textResult({
      activation: result,
      freshAnalysis: caseReport,
    });
  }),
);

server.registerTool(
  "flash_glasses_firmware",
  {
    description:
      "Install a hash-pinned reviewed Smart Glasses firmware main on the selected responsive temple route through the Case, from a local file or an archive releaseId. Mode 'differences' performs the reviewed Stock ↔ CFW differential transfer using the archived counterpart as the verified source.",
    inputSchema: {
      firmwarePath: z
        .string()
        .min(1)
        .optional()
        .describe("Local reviewed EVENOTA package"),
      releaseId: z
        .string()
        .min(1)
        .optional()
        .describe("Verified firmware archive release id (see list_firmware_catalog)"),
      route: z.enum(["left", "right", "both"]).default("both"),
      mode: z
        .enum(["complete", "differences"])
        .default("complete")
        .describe(
          "'complete' rewrites the pinned Apollo main; 'differences' transfers only the changed component of an exact reviewed Stock ↔ compatible CFW pair",
        ),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  tool(async ({ firmwarePath, releaseId, route, mode }, extra) => {
    updateSessionProgress(extra);
    if (!caseReport) {
      throw new Error("Run analyze_case immediately before flashing.");
    }
    if (!backupRecord) {
      throw new Error(
        "Save a verified backup_system or backup_case before flashing Smart Glasses.",
      );
    }
    const firmware = await resolveFirmwareInput({ firmwarePath, releaseId });
    let differenceSourceFirmware = null;
    if (mode === "differences") {
      ({ source: differenceSourceFirmware } =
        await prepareDifferenceSource(firmware));
    }
    try {
      const audit = await caseSession.flashPinnedTempleMain(
        firmware,
        route,
        { mode, differenceSourceFirmware },
      );
      recordInstalledProvenance(caseReport, audit);
      return textResult(audit);
    } catch (error) {
      if (!error?.audit) throw error;
      recordInstalledProvenance(caseReport, error.audit);
      record(error.message, "error");
      return textResult(
        { error: error.message, audit: error.audit },
        true,
      );
    }
  }),
);

server.registerTool(
  "automatic_apply",
  {
    description:
      "Run the WebFlasher's Automatic Apply workflow: re-analyze and update the Case when needed, read both installed temple versions, issue a clean-start bilateral reset, then install the selected Smart Glasses release using verify-only, reviewed differential, or complete-main mode. A differential boot/liveness failure retries the complete main only after exact cleanup and another bilateral recovery reset prove both applications remain reachable.",
    inputSchema: {
      releaseId: z
        .string()
        .min(1)
        .describe(
          "Target Smart Glasses release id from the verified firmware archive (see list_firmware_catalog)",
        ),
      installMode: z
        .enum(AUTOMATIC_INSTALL_MODES)
        .default(DEFAULT_AUTOMATIC_INSTALL_MODE)
        .describe(
          "'update' selects the safest sufficient transfer; 'restore' always rewrites the complete pinned main",
        ),
      updateCaseFirst: z
        .boolean()
        .default(true)
        .describe("Update the Charging Case to the latest verified firmware first when it is older"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  tool(async ({ releaseId, installMode, updateCaseFirst }, extra) => {
    updateSessionProgress(extra);
    if (!caseReport) {
      throw new Error(
        "Run analyze_case before automatic_apply so the session starts from a fresh analysis.",
      );
    }
    const releases = await loadCatalog();
    const release = await requireCatalogRelease(releaseId);
    const latestCaseFirmwareRelease = findLatestCaseFirmwareRelease(releases);
    record(
      `Automatic Apply requested · Smart Glasses ${installMode} · Update Charging Case first ${updateCaseFirst ? "enabled" : "disabled"}.`,
    );

    let fresh = await caseSession.analyze({
      progressBase: 0.01,
      progressSpan: 0.07,
    });
    caseReport = fresh;
    const caseUpdatePlan = resolveAutomaticCaseUpdatePlan({
      enabled: updateCaseFirst,
      currentVersion: fresh.console?.caseVersion,
      targetRelease: latestCaseFirmwareRelease,
    });
    if (!caseUpdatePlan.executable) {
      throw new Error(caseUpdatePlan.reason);
    }
    const contactPreflight = assessAutomaticTempleContacts(
      fresh.console?.telemetry,
    );
    if (!contactPreflight.automaticApplyAllowed) {
      throw new Error(contactPreflight.reason);
    }
    if (caseUpdatePlan.targetVersion !== REVIEWED_CASE_VERSION) {
      throw new Error(
        `This WebFlasher's glasses writer requires Case ${REVIEWED_CASE_VERSION}, but the latest library Case is ${caseUpdatePlan.targetVersion}. Update the WebFlasher before continuing.`,
      );
    }
    if (contactPreflight.resetRecoveryEligible) {
      record(
        `${contactPreflight.reason} Automatic Apply will attempt the traced bilateral reset and require both temples to return before any firmware transfer.`,
        "warn",
      );
    }

    let caseUpdate = null;
    let caseUpdateFirmware = null;
    if (caseUpdatePlan.action === "update") {
      record(
        `Updating Charging Case ${caseUpdatePlan.currentVersion} → ${caseUpdatePlan.targetVersion}.`,
        "warn",
      );
      caseUpdateFirmware = await firmwareFromCatalogRelease(
        latestCaseFirmwareRelease,
      );
      caseUpdate = await executeAutomaticCaseUpdate({
        session: caseSession,
        currentReport: fresh,
        targetFirmware: caseUpdateFirmware,
        onStep: (step) => record(`Automatic Case update step: ${step}.`),
      });
      fresh = caseUpdate.report;
      stagedCase = null;
      const postUpdateConsole = await caseSession.readTempleFlashPreflight([]);
      fresh = {
        ...fresh,
        console: {
          ...fresh.console,
          ...postUpdateConsole,
        },
      };
      caseReport = fresh;
      record(
        `Charging Case updated ${caseUpdatePlan.currentVersion} → ${caseUpdatePlan.targetVersion}; physical bank ${caseUpdate.bankSwitch.stagedPhysicalBank} activated, physical bank ${caseUpdate.bankSwitch.fallbackPhysicalBank} preserved as the ${caseUpdate.bankSwitch.fallbackVersion} fallback.`,
        "success",
      );
    }

    const caseReadiness = verifyAutomaticCaseReadiness(
      fresh,
      caseUpdatePlan.targetVersion,
    );
    record(
      `Charging Case write gate passed · active physical bank ${caseReadiness.activePhysicalBank} ${caseReadiness.activeVersion} · fallback physical bank ${caseReadiness.fallbackPhysicalBank} ${caseReadiness.fallbackVersion ?? "version unknown"}.`,
      "success",
    );

    const templePreparation = await prepareAutomaticTempleUpdate({
      session: caseSession,
      progressBase: caseUpdatePlan.action === "update" ? 0.5 : 0.09,
      progressSpan: 0.06,
      onStep: ({ step, route }) => {
        record(
          step === "version-check"
            ? `Checking ${route} installed version before the clean-start reset.`
            : "Issuing the clean-start bilateral reset before deployment planning.",
        );
      },
    });
    const {
      initialVersions,
      observedTempleVersions,
      changedAcrossReset,
      verifiedTempleReadiness: templeReadiness,
    } = templePreparation;
    fresh = {
      ...fresh,
      console: {
        ...fresh.console,
        ...templeReadiness,
        telemetry: templeReadiness.telemetry,
      },
    };
    caseReport = fresh;
    record(
      `Smart Glasses read-only version check passed · right ${initialVersions.right.firmwareVersion}/hardware ${initialVersions.right.hardwareRevision} · left ${initialVersions.left.firmwareVersion}/hardware ${initialVersions.left.hardwareRevision}.`,
      "success",
    );
    record(
      `Clean-start DEB0 passed · right ${observedTempleVersions.right.firmwareVersion}/hardware ${observedTempleVersions.right.hardwareRevision} · left ${observedTempleVersions.left.firmwareVersion}/hardware ${observedTempleVersions.left.hardwareRevision}.`,
      "success",
    );
    if (changedAcrossReset.length > 0) {
      record(
        `Temple identity changed across the clean-start reset on ${changedAcrossReset.join(" + ")}; Automatic Apply will plan from the fresh post-reset identity.`,
        "warn",
      );
    }

    const targetFirmware =
      caseUpdateFirmware?.catalogRelease?.id === release.id
        ? caseUpdateFirmware
        : await firmwareFromCatalogRelease(release);

    let sourceFirmware = null;
    let differencePlan = null;
    if (installMode === "update") {
      const counterpart = findStockCfwCounterpartRelease(
        releases,
        targetFirmware,
      );
      if (counterpart) {
        sourceFirmware = await firmwareFromCatalogRelease(counterpart);
        differencePlan = buildBundleDifferencePlan(
          sourceFirmware,
          targetFirmware,
        );
      }
    }

    try {
      const execution = await executeAutomaticApply({
        session: caseSession,
        installMode,
        targetFirmware,
        installedProvenance: deviceProvenance(fresh),
        differenceSourceFirmware: sourceFirmware,
        differencePlan,
        initialTempleVersions: initialVersions,
        observedTempleVersions,
        verifiedTempleReadiness: templeReadiness,
        onPlan: (applyPlan) => {
          record(
            `Automatic ${installMode} plan accepted · ${applyPlan.reason}`,
            "success",
          );
        },
        onRecovery: (recovery) => {
          record(
            recovery.trigger !== "source-preflight-mismatch"
              ? `Differential transfer reached FINISH, but ${recovery.failedRoutes.join(" + ")} did not return the expected target liveness. Exact cleanup is proven; Automatic Update is resetting both temples before the complete pinned target main.`
              : `Differential preflight observed ${recovery.observedVersion}/hardware 5 before START. No firmware bytes were accepted and cleanup is proven; Automatic Update is resetting both temples before the complete pinned target main.`,
            "warn",
          );
        },
      });

      if (execution.action === "verify-only") {
        caseReport = {
          ...fresh,
          console: {
            ...fresh.console,
            ...execution.result,
            telemetry: execution.result.telemetry,
          },
        };
        record(
          "Already up to date · both temples reset and verified.",
          "success",
        );
        return textResult({
          action: "verify-only",
          caseUpdate: caseUpdatePlan,
          caseBankSwitch: caseUpdate?.bankSwitch ?? null,
          plan: execution.plan,
          templeReadiness: execution.result,
        });
      }

      recordInstalledProvenance(fresh, execution.audit);
      record(
        `Automatic ${installMode} completed on right + left${execution.initialPlan ? " after safe differential-to-complete fallback" : ""} with FINISH, route restoration, final DEB0 reset, contacts, and application liveness verified.`,
        "success",
      );
      return textResult({
        action: "flash",
        caseUpdate: caseUpdatePlan,
        caseBankSwitch: caseUpdate?.bankSwitch ?? null,
        plan: execution.plan,
        differentialFallback: Boolean(execution.initialPlan),
        audit: execution.audit,
      });
    } catch (error) {
      if (!error?.audit) throw error;
      recordInstalledProvenance(fresh, error.audit);
      record(error.message, "error");
      return textResult(
        { error: error.message, audit: error.audit },
        true,
      );
    }
  }),
);

server.registerTool(
  "serial_exchange",
  {
    description:
      "Perform one bounded raw serial exchange with the selected G2 Case for expert troubleshooting. The port is always closed afterward.",
    inputSchema: {
      profile: z.enum(["case_console", "stm32_rom"]),
      writeHex: z
        .string()
        .regex(/^(?:[0-9a-fA-F]{2}){0,16384}$/)
        .describe("Bytes to transmit as contiguous hexadecimal"),
      readBytes: z.number().int().min(0).max(16_384).default(0),
      timeoutMs: z.number().int().min(1).max(30_000).default(3_000),
      dataTerminalReady: z.boolean().default(false),
      requestToSend: z.boolean().default(false),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  tool(async ({
    profile,
    writeHex,
    readBytes,
    timeoutMs,
    dataTerminalReady,
    requestToSend,
  }) => {
    const { remotePort: selectedPort } = requireConnection();
    const options =
      profile === "case_console"
        ? {
            baudRate: 1_000_000,
            dataBits: 8,
            stopBits: 1,
            parity: "none",
            flowControl: "none",
            bufferSize: 4096,
          }
        : {
            baudRate: 115_200,
            dataBits: 8,
            stopBits: 1,
            parity: "even",
            flowControl: "none",
            bufferSize: 4096,
          };
    await selectedPort.open(options);
    let reader = null;
    let writer = null;
    try {
      await selectedPort.setSignals({
        dataTerminalReady,
        requestToSend,
      });
      reader = selectedPort.readable.getReader();
      writer = selectedPort.writable.getWriter();
      if (writeHex) {
        await writer.write(Uint8Array.from(Buffer.from(writeHex, "hex")));
      }
      const received = [];
      let count = 0;
      const deadline = Date.now() + timeoutMs;
      while (count < readBytes && Date.now() < deadline) {
        const remaining = deadline - Date.now();
        const read = reader.read();
        const timeout = new Promise((resolveTimeout) =>
          setTimeout(
            () => resolveTimeout({ timeout: true }),
            Math.max(1, remaining),
          ),
        );
        const result = await Promise.race([read, timeout]);
        if (result.timeout || result.done) break;
        received.push(result.value);
        count += result.value.byteLength;
      }
      const combined = new Uint8Array(count);
      let offset = 0;
      for (const chunk of received) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return textResult({
        profile,
        transmittedHex: writeHex,
        receivedHex: Buffer.from(combined).toString("hex"),
        receivedBytes: combined.byteLength,
      });
    } finally {
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          // The remote serial session may already have closed.
        }
        reader.releaseLock();
      }
      writer?.releaseLock();
      await selectedPort.close();
    }
  }),
);

server.registerTool(
  "remote_support_status",
  {
    description:
      "Return connection state, latest operation progress, saved backup metadata, staged state, firmware archive state, and recent technician logs.",
    inputSchema: {
      logEntries: z.number().int().min(0).max(200).default(50),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  tool(async ({ logEntries }) =>
    textResult({
      connected: Boolean(connection && remotePort),
      session: connection?.session ?? null,
      analyzed: Boolean(caseReport),
      backup: backupRecord,
      stagedCase: stagedCase
        ? {
            version: stagedCase.firmware.caseVersion,
            sha256: stagedCase.result.sourceSha256,
          }
        : null,
      firmwareCatalog: catalogSource,
      installedProvenance: Object.fromEntries(installedProvenanceByDevice),
      progress: currentProgress,
      logs: eventLog.slice(-logEntries),
    }),
  ),
);

server.registerTool(
  "disconnect_remote_case",
  {
    description:
      "Close the remote serial interface and leave the customer's support session.",
    inputSchema: {},
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  tool(async () => {
    await remotePort?.dispose();
    connection?.close();
    remotePort = null;
    caseSession = null;
    connection = null;
    caseReport = null;
    backupRecord = null;
    stagedCase = null;
    currentProgress = null;
    return textResult("Remote G2 Case session disconnected.");
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
