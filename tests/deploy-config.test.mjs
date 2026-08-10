import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("Caddy automatically serves release-bound firmware from the atomic WebFlasher root", async () => {
  const [caddy, catalog] = await Promise.all([
    readFile(new URL("../deploy/webflasher.caddy", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../public/firmware-updates/source-files/index.json",
        import.meta.url,
      ),
      "utf8",
    ).then(JSON.parse),
  ]);

  assert.match(caddy, /handle \/firmware-updates\/\*\s*\{/);
  assert.match(
    caddy,
    /@releaseBoundFirmware\s*\{\s*path \/firmware-updates\/source-files\/\*\s+file\s*\{\s*root \/share\/webflasher\s*\}\s*\}/,
  );
  assert.match(
    caddy,
    /handle @releaseBoundFirmware\s*\{\s*root \* \/share\/webflasher\s+file_server\s*\}/,
  );
  assert.match(
    caddy,
    /handle\s*\{\s*root \* \/share\/sybilsight\s+file_server\s*\}/,
  );
  assert.doesNotMatch(
    caddy,
    /handle \/firmware-updates\/source-files\/(?:[0-9]|r1\/)/,
    "firmware releases must not require version-specific Caddy routes",
  );
  const releaseBound = [];
  for (const release of catalog.releases) {
    try {
      const target = await stat(
        new URL(`../public${release.url}`, import.meta.url),
      );
      if (target.isFile()) releaseBound.push(release);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  assert.ok(releaseBound.length > 0);
  for (const release of releaseBound) {
    assert.match(
      release.url,
      /^\/firmware-updates\/source-files\//,
      `${release.version} must be covered by the file-aware firmware matcher`,
    );
  }
});

test("production Caddy verification accepts the exact WebFlasher site block", async () => {
  const expected = await readFile(
    new URL("../deploy/webflasher.caddy", import.meta.url),
    "utf8",
  );
  const directory = await mkdtemp(join(tmpdir(), "webflasher-caddy-test-"));
  try {
    const activePath = join(directory, "Caddyfile");
    const expectedPath = join(directory, "webflasher.caddy");
    await Promise.all([
      writeFile(
        activePath,
        `other.example {\n\trespond "ok"\n}\n\n${expected}\nafter.example {\n\trespond "ok"\n}\n`,
      ),
      writeFile(expectedPath, expected),
    ]);

    const result = spawnSync(
      "sh",
      [
        new URL(
          "../scripts/verify-webflasher-caddy.sh",
          import.meta.url,
        ).pathname,
        activePath,
        expectedPath,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production Caddy verification rejects a stale WebFlasher site block", async () => {
  const expected = await readFile(
    new URL("../deploy/webflasher.caddy", import.meta.url),
    "utf8",
  );
  const stale = expected.replace(
    "\t\t\t\troot /share/webflasher\n",
    "\t\t\t\troot /share/sybilsight\n",
  );
  assert.notEqual(stale, expected);
  const directory = await mkdtemp(join(tmpdir(), "webflasher-caddy-test-"));
  try {
    const activePath = join(directory, "Caddyfile");
    const expectedPath = join(directory, "webflasher.caddy");
    await Promise.all([
      writeFile(activePath, stale),
      writeFile(expectedPath, expected),
    ]);

    const result = spawnSync(
      "sh",
      [
        new URL(
          "../scripts/verify-webflasher-caddy.sh",
          import.meta.url,
        ).pathname,
        activePath,
        expectedPath,
      ],
      { encoding: "utf8" },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not match the deployment source/);
    assert.equal(result.stdout, "", "active Caddy directives must not enter CI logs");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production Caddy verification rejects duplicate WebFlasher blocks", async () => {
  const expected = await readFile(
    new URL("../deploy/webflasher.caddy", import.meta.url),
    "utf8",
  );
  const directory = await mkdtemp(join(tmpdir(), "webflasher-caddy-test-"));
  try {
    const activePath = join(directory, "Caddyfile");
    const expectedPath = join(directory, "webflasher.caddy");
    await Promise.all([
      writeFile(activePath, `${expected}\n${expected}`),
      writeFile(expectedPath, expected),
    ]);

    const result = spawnSync(
      "sh",
      [
        new URL(
          "../scripts/verify-webflasher-caddy.sh",
          import.meta.url,
        ).pathname,
        activePath,
        expectedPath,
      ],
      { encoding: "utf8" },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exactly one WebFlasher site block/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deployment verifies the active production Caddy block before publishing", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /cp deploy\/webflasher\.caddy .*webflasher\.caddy/);
  assert.match(
    workflow,
    /cp scripts\/verify-webflasher-caddy\.sh .*verify-webflasher-caddy\.sh/,
  );
  assert.match(
    workflow,
    /scp .*Caddyfile.*active-Caddyfile[\s\S]*verify-webflasher-caddy\.sh[\s\S]*active-Caddyfile[\s\S]*webflasher\.caddy[\s\S]*- name: Deploy website/,
  );
  assert.match(
    workflow,
    /sh "\$\{release_dir\}\/verify-webflasher-caddy\.sh"/,
    "artifact downloads do not preserve executable mode",
  );
});

test("deployment preserves immutable package bytes while allowing archive enrichment", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /for required_command in[^\n]*\bcmp\b[^\n]*\bsed\b/);
  assert.match(workflow, /"sourceFile":\[\[:space:\]\]\*"/);
  assert.match(
    workflow,
    /cmp -s "\$\{firmware_source_package\}" "\$\{firmware_target_package\}"/,
  );
  assert.match(
    workflow,
    /metadata\.json\|SHA256SUMS\|manifest\.json\) continue/,
  );
  assert.match(
    workflow,
    /cmp -s "\$\{firmware_source_file\}" "\$\{firmware_target_file\}"/,
  );
  assert.doesNotMatch(workflow, /diff -qr "\$\{firmware_source_dir\}"/);
});
