import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL("../public/app-versions.json", import.meta.url);

function assertTimestamp(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
  assert.equal(Number.isNaN(Date.parse(value)), false, `${label} must be parseable`);
}

function assertRelease(release) {
  assert.equal(typeof release.bundleIdentifier, "string");
  assert.match(release.version, /^\d+(?:\.\d+)*$/);
  assert.match(release.build, /^\d+(?:\.\d+)*$/);
  assert.ok(["appStore", "testFlight"].includes(release.channel));
  assertTimestamp(release.releasedAt, "releasedAt");
  const updateURL = new URL(release.updateURL);
  if (release.channel === "testFlight") {
    assert.ok(
      updateURL.protocol === "itms-beta:" ||
        (updateURL.protocol === "https:" && updateURL.hostname === "testflight.apple.com"),
    );
  } else {
    assert.ok(
      updateURL.protocol === "itms-apps:" ||
        (updateURL.protocol === "https:" && updateURL.hostname === "apps.apple.com"),
    );
  }
}

test("app version manifest is a valid append-only release ledger", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assertTimestamp(manifest.generatedAt, "generatedAt");
  assert.ok(Array.isArray(manifest.releases));
  manifest.releases.forEach(assertRelease);

  const identities = manifest.releases.map((release) =>
    [release.bundleIdentifier, release.version, release.build, release.channel].join("|"),
  );
  assert.equal(new Set(identities).size, identities.length, "release identities must be unique");
});
