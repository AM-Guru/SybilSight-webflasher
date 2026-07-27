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
    "analyze_case",
    "read_temple",
    "reset_and_recheck_glasses",
    "backup_case",
    "stage_case_firmware",
    "activate_staged_case_firmware",
    "flash_glasses_firmware",
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
    tools.get("flash_glasses_firmware").annotations.destructiveHint,
    true,
  );

  const status = await client.callTool({
    name: "remote_support_status",
    arguments: { logEntries: 0 },
  });
  assert.equal(status.isError, undefined);
  assert.match(status.content[0].text, /"connected": false/);
});
