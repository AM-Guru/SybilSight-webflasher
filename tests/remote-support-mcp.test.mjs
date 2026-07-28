import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("exposes the bounded remote Case tools to Codex over MCP stdio", async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["scripts/remote_support_mcp.mjs"],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      SUPPORT_OPERATOR_KEY: "test-only-mcp-operator-key-with-32-characters",
    },
    stderr: "pipe",
  });
  const client = new Client(
    {
      name: "remote-support-mcp-test",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );
  t.after(async () => {
    await client.close();
  });
  await client.connect(transport);

  const listed = await client.listTools();
  const tools = new Map(listed.tools.map((entry) => [entry.name, entry]));
  for (const name of [
    "join_remote_case",
    "list_firmware_catalog",
    "analyze_case",
    "read_temple",
    "reset_and_recheck_glasses",
    "backup_case",
    "backup_system",
    "stage_case_firmware",
    "activate_staged_case_firmware",
    "flash_glasses_firmware",
    "automatic_apply",
    "serial_exchange",
    "remote_support_status",
    "disconnect_remote_case",
  ]) {
    assert.equal(tools.has(name), true, `missing MCP tool ${name}`);
  }
  assert.equal(
    tools.get("analyze_case").annotations.readOnlyHint,
    true,
  );
  assert.equal(
    tools.get("list_firmware_catalog").annotations.readOnlyHint,
    true,
  );
  for (const name of [
    "reset_and_recheck_glasses",
    "stage_case_firmware",
    "activate_staged_case_firmware",
    "flash_glasses_firmware",
    "automatic_apply",
  ]) {
    assert.equal(
      tools.get(name).annotations.destructiveHint,
      true,
      `${name} must be annotated destructive`,
    );
  }
  const flashSchema = tools.get("flash_glasses_firmware").inputSchema;
  assert.deepEqual(flashSchema.properties.mode.enum, [
    "complete",
    "differences",
  ]);
  assert.ok(flashSchema.properties.releaseId, "flash accepts releaseId");
  assert.ok(
    tools.get("stage_case_firmware").inputSchema.properties.releaseId,
    "stage accepts releaseId",
  );
  assert.deepEqual(
    tools.get("automatic_apply").inputSchema.properties.installMode.enum,
    ["update", "restore"],
  );

  const status = await client.callTool({
    name: "remote_support_status",
    arguments: { logEntries: 0 },
  });
  assert.equal(status.isError, undefined);
  assert.match(status.content[0].text, /"connected": false/);

  const hardwareGate = await client.callTool({
    name: "automatic_apply",
    arguments: { releaseId: "g2-official-2.2.6.10" },
  });
  assert.equal(hardwareGate.isError, true);
  assert.match(
    hardwareGate.content[0].text,
    /Join a customer's remote-support session first\./,
  );

  const backupGate = await client.callTool({
    name: "backup_system",
    arguments: { outputPath: "unused.g2-backup.json" },
  });
  assert.equal(backupGate.isError, true);
  assert.match(
    backupGate.content[0].text,
    /Join a customer's remote-support session first\./,
  );
});
