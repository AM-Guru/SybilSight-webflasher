import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("Caddy serves release-bound firmware from the atomic WebFlasher root", async () => {
  const caddy = await readFile(
    new URL("../deploy/webflasher.caddy", import.meta.url),
    "utf8",
  );

  assert.match(
    caddy,
    /@releaseFirmware\s*\{\s*path \/firmware-updates\/source-files\/\*\s+file\s*\{\s*root \/share\/webflasher\s*\}\s*\}/,
  );
  assert.match(
    caddy,
    /handle @releaseFirmware\s*\{\s*root \* \/share\/webflasher\s+file_server\s*\}/,
  );
  assert.doesNotMatch(
    caddy,
    /handle \/firmware-updates\/source-files\/(?:2\.|r1\/)/,
  );
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
    "\t\t\troot /share/webflasher\n",
    "\t\t\troot /share/stale-webflasher\n",
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

test("deployment reconciles and verifies production Caddy before publishing", async () => {
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
    /cp scripts\/reconcile-webflasher-caddy\.sh .*reconcile-webflasher-caddy\.sh/,
  );
  assert.match(
    workflow,
    /scp .*remote_caddyfile.*active_caddyfile[\s\S]*reconcile-webflasher-caddy\.sh[\s\S]*candidate_caddyfile[\s\S]*ha apps restart c80c7555_caddy-2[\s\S]*ROLLBACK_CADDY_SCRIPT[\s\S]*verify-webflasher-caddy\.sh[\s\S]*- name: Deploy website/,
  );
  assert.match(
    workflow,
    /sh "\$\{release_dir\}\/(?:reconcile|verify)-webflasher-caddy\.sh"/,
    "artifact downloads do not preserve executable mode",
  );
  assert.match(workflow, /Production Caddy did not become healthy/);
  assert.match(
    workflow,
    /--header 'Cache-Control: no-cache'[\s\\]+"https:\/\/webflasher\.sybilsight\.com\/remote-support\/healthz"/,
  );
  assert.doesNotMatch(workflow, /remote-support\/healthz\?caddy=/);
});

test("deployment updates a version-changing local app and rebuilds same-version sources", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  );
  const activator = await readFile(
    new URL("../scripts/activate-homeassistant-app.sh", import.meta.url),
    "utf8",
  );

  assert.match(
    workflow,
    /cp scripts\/activate-homeassistant-app\.sh .*activate-homeassistant-app\.sh/,
  );
  assert.match(workflow, /activate-homeassistant-app\.sh[\s\\]+reconcile-webflasher-caddy\.sh[\s\\]+verify-webflasher-caddy\.sh/);
  assert.match(
    workflow,
    /sh -s --[\s\\]+"\$\{REMOTE_SUPPORT_APP\}" "\$\{remote_target\}" < "\$\{activate_script\}"/,
  );
  assert.doesNotMatch(workflow, /ha addons/);
  assert.match(activator, /ha store reload --no-progress/);
  assert.match(activator, /action=rebuild/);
  assert.match(activator, /action=update/);
  assert.match(activator, /ha apps "\$\{action\}" "\$\{app_slug\}" --no-progress/);
  assert.match(activator, /observed_state.*started/);
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
    /if \[ -f "\$\{firmware_source_dir\}\/metadata\.json" \] &&/,
  );
  assert.match(
    workflow,
    /Raw source directories intentionally omit that/,
  );
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
