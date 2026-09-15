import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyG2Firmware, REVIEWED_CFW_2_2_10_72 } from "../src/lib/firmware.js";
import { findTempleFlashTarget } from "../src/lib/templeFlashTargets.js";

for (const release of [REVIEWED_CFW_2_2_10_72]) {
test(`${release.version} CFW is pinned and served as the catalog's only custom release`, async () => {
  const trust = classifyG2Firmware(release.sha256);
  assert.equal(trust.baseVersion, "2.2.10.10");
  assert.equal(trust.version, release.version);
  const target = findTempleFlashTarget(release.sha256);
  assert.equal(target.localOnly, undefined);
  assert.equal(target.hardwareValidated, false);
  assert.equal(target.mainSha256, release.mainPayloadSha256);
  assert.equal(target.mainBytes, release.mainPayloadBytes);
  assert.deepEqual(target.bleComponentNames, ["ota/s200_firmware_ota.bin"]);
  const catalog = JSON.parse(await readFile(
    new URL("../public/firmware-updates/source-files/index.json", import.meta.url), "utf8",
  ));
  const custom = catalog.releases.filter((r) => r.channel === "custom");
  assert.deepEqual(custom.map((r) => r.sha256), [release.sha256]);
});
}
