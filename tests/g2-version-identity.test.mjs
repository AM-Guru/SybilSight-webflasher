import assert from "node:assert/strict";
import test from "node:test";
import { TEMPLE_FLASH_TARGETS } from "../src/lib/templeFlashTargets.js";
import { g2VersionCanIdentifyTarget } from "../src/lib/g2VersionIdentity.js";
import { resolveAutomaticApplyPlan } from "../src/lib/automaticRecovery.js";

const targets = TEMPLE_FLASH_TARGETS.filter((target) => target.reportedVersion === "2.3.0.24");
const observations = Object.fromEntries(["left", "right"].map((side) => [side,
  { firmwareVersion: "2.3.0.24", hardwareRevision: 5 }]));

test("same donor version cannot skip Stock or CFW installation, even with a saved audit", () => {
  assert.ok(targets.some((target) => target.requiredCfwMarker));
  assert.ok(targets.some((target) => !target.requiredCfwMarker));
  for (const target of targets) {
    const firmware = { templeFlashEligible: true, fileSha256: target.imageSha256, templeFlashTarget: target };
    assert.equal(g2VersionCanIdentifyTarget(firmware, target.reportedVersion), false);
    for (const installedProvenance of [{}, Object.fromEntries(["left", "right"].map((side) =>
      [side, { imageSha256: target.imageSha256 }]))]) {
      const plan = resolveAutomaticApplyPlan({ targetFirmware: firmware,
        observedTempleVersions: observations, installedProvenance });
      assert.equal(plan.executable, true);
      assert.equal(plan.action, "flash");
      assert.equal(plan.flashMode, "complete");
      assert.equal(plan.route, "both");
    }
  }
});

test("a unique public version retains the no-write update optimization", () => {
  const target = TEMPLE_FLASH_TARGETS.find((entry) => entry.version === "2.2.10.10");
  assert.ok(target);
  assert.equal(g2VersionCanIdentifyTarget({ templeFlashTarget: target }, target.reportedVersion), true);
  assert.equal(g2VersionCanIdentifyTarget({}, null), false);
});
