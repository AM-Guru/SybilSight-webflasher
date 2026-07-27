#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { userInfo } from "node:os";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocket } from "ws";
import { z } from "zod/v4";

import { parseFirmwareInput } from "../src/lib/firmware.js";
import { RemoteG2CasePort } from "../src/lib/remoteSerial.js";
import {
  RemoteSupportConnection,
  remoteJsonValue,
} from "../src/lib/remoteSupport.js";
import { G2CaseSession } from "../src/lib/serial.js";

const DEFAULT_RELAY_URL =
  "wss://webflasher.sybilsight.com/remote-support/ws";
const KEYCHAIN_SERVICE = "SybilSight WebFlasher Remote Support";

let connection = null;
let remotePort = null;
let caseSession = null;
let caseReport = null;
let backupRecord = null;
let stagedCase = null;
let currentProgress = null;
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

function tool(handler) {
  return async (input, extra) => {
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

const server = new McpServer(
  {
    name: "sybilsight-webflasher-support",
    version: "0.2.0",
  },
  {
    capabilities: {
      logging: {},
    },
    instructions:
      "This server operates only the exact G2 Case USB serial interface selected and authorized in the customer's open WebFlasher session. Join a session before using hardware tools. Prefer analyze_case and read_temple before mutation. Case activation and Smart Glasses flashing are destructive hardware operations; require explicit technician intent, a fresh analysis, and a saved backup. The customer does not need to approve individual commands after starting the session.",
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
      "Issue the traced bilateral G2 temple reset through the selected Case and verify that both applications return.",
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
    return textResult(await caseSession.restartAndRecheck());
  }),
);

server.registerTool(
  "backup_case",
  {
    description:
      "Read and save a verified 512 KiB Case flash and option-byte backup on the technician computer before recovery.",
    inputSchema: {
      outputPath: z
        .string()
        .min(1)
        .describe("Explicit local path for the private JSON backup"),
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
    const backup = await caseSession.backup();
    const resolvedPath = resolve(outputPath);
    await writeFile(
      resolvedPath,
      `${JSON.stringify({
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        flashSha256: backup.flashSha256,
        optionSha256: backup.optionSha256,
        flashBase64: Buffer.from(backup.flash).toString("base64"),
        optionBytesBase64: Buffer.from(backup.optionBytes).toString("base64"),
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    backupRecord = {
      outputPath: resolvedPath,
      flashSha256: backup.flashSha256,
      optionSha256: backup.optionSha256,
    };
    return textResult(backupRecord);
  }),
);

server.registerTool(
  "stage_case_firmware",
  {
    description:
      "Erase, write, and byte-verify an eligible Case image in the inactive bank. Requires a fresh analysis and saved backup.",
    inputSchema: {
      firmwarePath: z
        .string()
        .min(1)
        .describe("Local reviewed firmware package or Case image"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  tool(async ({ firmwarePath }, extra) => {
    updateSessionProgress(extra);
    if (!caseReport?.optionBytes) {
      throw new Error("Run analyze_case immediately before staging.");
    }
    if (!backupRecord) {
      throw new Error("Save a verified backup_case before staging firmware.");
    }
    const input = new Uint8Array(await readFile(resolve(firmwarePath)));
    const firmware = await parseFirmwareInput(input, basename(firmwarePath));
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
      "Install a hash-pinned reviewed Smart Glasses firmware main on the selected responsive temple route through the Case.",
    inputSchema: {
      firmwarePath: z.string().min(1).describe("Local reviewed EVENOTA package"),
      route: z.enum(["left", "right", "both"]).default("both"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  tool(async ({ firmwarePath, route }, extra) => {
    updateSessionProgress(extra);
    if (!caseReport) {
      throw new Error("Run analyze_case immediately before flashing.");
    }
    if (!backupRecord) {
      throw new Error("Save a verified backup_case before flashing Smart Glasses.");
    }
    const input = new Uint8Array(await readFile(resolve(firmwarePath)));
    const firmware = await parseFirmwareInput(input, basename(firmwarePath));
    const audit = await caseSession.flashPinnedTempleMain(
      firmware,
      route,
      { mode: "complete" },
    );
    return textResult(audit);
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
      "Return connection state, latest operation progress, saved backup metadata, staged state, and recent technician logs.",
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
