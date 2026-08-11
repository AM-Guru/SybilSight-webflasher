import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const activator = new URL(
  "../scripts/activate-homeassistant-app.sh",
  import.meta.url,
);

const mockHa = `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "\${MOCK_HA_LOG}"
case "$1 $2" in
  "store reload")
    exit 0
    ;;
  "apps info")
    installed="$(cat "\${MOCK_INSTALLED_VERSION}")"
    latest="\${MOCK_LATEST_VERSION:-$(sed -n 's/^version:[[:space:]]*"\\([^"]*\\)"[[:space:]]*$/\\1/p' "\${MOCK_SOURCE_DIR}/config.yaml")}" 
    update=false
    [ "\${installed}" = "\${latest}" ] || update=true
    printf '{"data":{"version":"%s","version_latest":"%s","update_available":%s,"state":"started"}}\\n' \
      "\${installed}" "\${latest}" "\${update}"
    ;;
  "apps update")
    sed -n 's/^version:[[:space:]]*"\\([^"]*\\)"[[:space:]]*$/\\1/p' \
      "\${MOCK_SOURCE_DIR}/config.yaml" > "\${MOCK_INSTALLED_VERSION}"
    [ "\${MOCK_ACTION_FAILURE:-0}" -eq 0 ]
    ;;
  "apps rebuild")
    [ "\${MOCK_ACTION_FAILURE:-0}" -eq 0 ]
    ;;
  *)
    echo "Unexpected mock ha invocation: $*" >&2
    exit 90
    ;;
esac
`;

async function runActivation({
  installed = "2.1.0",
  source = "3.0.0",
  latest,
  actionFailure = false,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "homeassistant-app-activation-"));
  const bin = join(directory, "bin");
  const sourceDirectory = join(directory, "source");
  const installedVersion = join(directory, "installed-version");
  const log = join(directory, "ha.log");
  await mkdir(bin);
  await mkdir(sourceDirectory);
  await writeFile(join(sourceDirectory, "config.yaml"), `version: "${source}"\n`);
  await writeFile(installedVersion, `${installed}\n`);
  await writeFile(log, "");
  await writeFile(join(bin, "ha"), mockHa);
  await chmod(join(bin, "ha"), 0o755);

  const result = spawnSync(
    "sh",
    [activator.pathname, "local_sybilsight_remote_support", sourceDirectory],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        MOCK_HA_LOG: log,
        MOCK_INSTALLED_VERSION: installedVersion,
        MOCK_SOURCE_DIR: sourceDirectory,
        EXPECTED_HOME_ASSISTANT_APP_SOURCE: sourceDirectory,
        ...(latest ? { MOCK_LATEST_VERSION: latest } : {}),
        ...(actionFailure ? { MOCK_ACTION_FAILURE: "1" } : {}),
      },
    },
  );

  return {
    ...result,
    installedVersion: (await readFile(installedVersion, "utf8")).trim(),
    log: await readFile(log, "utf8"),
  };
}

test("a Home Assistant app version transition uses update", async () => {
  const result = await runActivation();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.installedVersion, "3.0.0");
  assert.match(result.log, /^store reload --no-progress$/m);
  assert.match(
    result.log,
    /^apps update local_sybilsight_remote_support --no-progress$/m,
  );
  assert.doesNotMatch(result.log, /^apps rebuild/m);
});

test("a same-version local source deployment uses rebuild", async () => {
  const result = await runActivation({ installed: "3.0.0" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.log,
    /^apps rebuild local_sybilsight_remote_support --no-progress$/m,
  );
  assert.doesNotMatch(result.log, /^apps update/m);
});

test("a CLI failure is accepted only when Supervisor proves the target is started", async () => {
  const result = await runActivation({ actionFailure: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.installedVersion, "3.0.0");
  assert.match(result.stdout, /Activated Home Assistant app/);
});

test("activation refuses stale Supervisor source metadata", async () => {
  const result = await runActivation({ latest: "2.1.0" });
  assert.equal(result.status, 67);
  assert.match(result.stderr, /reports app source 2\.1\.0, expected 3\.0\.0/);
  assert.doesNotMatch(result.log, /^apps (?:update|rebuild)/m);
});
