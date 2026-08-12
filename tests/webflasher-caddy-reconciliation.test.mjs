import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const reconcileScript = new URL(
  "../scripts/reconcile-webflasher-caddy.sh",
  import.meta.url,
);

const oldBlock = `# ---- webflasher.sybilsight.com ---------------------------------------------
webflasher.sybilsight.com {
\timport common
\thandle /old/* {
\t\troot * /share/old
\t}
}
`;

const expectedBlock = `# ---- webflasher.sybilsight.com ---------------------------------------------
webflasher.sybilsight.com {
\timport common
\thandle /new/* {
\t\troot * /share/new
\t}
}
`;

async function reconcile(active = oldBlock, expected = expectedBlock) {
  const directory = await mkdtemp(join(tmpdir(), "webflasher-caddy-reconcile-"));
  const activePath = join(directory, "Caddyfile");
  const expectedPath = join(directory, "webflasher.caddy");
  const outputPath = join(directory, "candidate-Caddyfile");
  await writeFile(activePath, active);
  await writeFile(expectedPath, expected);
  const result = spawnSync(
    "sh",
    [reconcileScript.pathname, activePath, expectedPath, outputPath],
    { encoding: "utf8" },
  );
  return {
    ...result,
    output: result.status === 0 ? await readFile(outputPath, "utf8") : null,
  };
}

test("replaces only the complete WebFlasher block", async () => {
  const prefix = `{
\temail admin@example.com
}

example.com {
\trespond "before {braces}"
}

`;
  const suffix = `
after.example.com {
\trespond "after"
}
`;
  const result = await reconcile(`${prefix}${oldBlock}${suffix}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, `${prefix}${expectedBlock}${suffix}`);
});

test("an already reconciled Caddyfile is byte-for-byte idempotent", async () => {
  const active = `# global\n${expectedBlock}\n# suffix\n`;
  const result = await reconcile(active);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, active);
});

test("refuses ambiguous production WebFlasher blocks", async () => {
  const result = await reconcile(`${oldBlock}\n${oldBlock}`);
  assert.equal(result.status, 66);
  assert.match(result.stderr, /exactly one WebFlasher site block/);
});

test("refuses an incomplete canonical WebFlasher block", async () => {
  const result = await reconcile(oldBlock, expectedBlock.replace(/}\n$/, ""));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no complete WebFlasher site block/);
});
