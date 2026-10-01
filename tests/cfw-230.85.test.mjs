import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyG2Firmware, REVIEWED_CFW_230_85 } from "../src/lib/firmware.js";
import { findTempleFlashTarget } from "../src/lib/templeFlashTargets.js";

test("230.85 keyboard CFW is pinned and is the only published custom release", async () => {
  const release = REVIEWED_CFW_230_85;
  const provenance = classifyG2Firmware(release.sha256);
  assert.equal(provenance.baseVersion, "2.3.0.24");
  assert.equal(provenance.capabilityMarker, "SybilSight/230.85");
  const target = findTempleFlashTarget(release.sha256);
  assert.equal(target.localOnly, undefined);
  assert.equal(target.hardwareValidated, false);
  assert.equal(target.mainSha256, release.mainPayloadSha256);
  assert.equal(target.mainBytes, release.mainPayloadBytes);
  assert.equal(target.bleComponentNames, undefined);
  const catalog = JSON.parse(await readFile(new URL(
    "../public/firmware-updates/source-files/index.json", import.meta.url), "utf8"));
  const custom = catalog.releases.filter((release) => release.channel === "custom");
  assert.deepEqual(custom.map((release) => release.sha256), [REVIEWED_CFW_230_85.sha256]);
});
