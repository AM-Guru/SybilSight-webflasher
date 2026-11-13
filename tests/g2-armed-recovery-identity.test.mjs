import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseFirmwareInput } from "../src/lib/firmware.js";
import { assertPinnedG2BleBundle } from "../src/lib/g2BleOta.js";
import { findTempleFlashTarget } from "../src/lib/templeFlashTargets.js";

const IMAGE_SHA = "aab93fc75ec964ccd94171b90db5cc83f3026d257e008a2bd7fb177e43469af6";
const MAIN_SHA = "bd4f242b8849e81b4d7d97ffcb1c78e7024251871c43da8833a9aa9368a182f5";

test("MRAM/SBL experiment is an exact local-only Bluetooth target", () => {
  const target = findTempleFlashTarget(IMAGE_SHA);
  assert.ok(target);
  assert.equal(target.mainSha256, MAIN_SHA);
  assert.equal(target.mainBytes, 3827984);
  assert.equal(target.version, "2.2.6.10");
  assert.equal(target.hardwareValidated, false);
  assert.equal(target.localOnly, true);
  assert.equal(target.recoveryExperiment, "apollo510-mram-sbl-early-arm");
  assert.deepEqual(target.bleComponentNames, ["ota/s200_firmware_ota.bin"]);
  assert.equal(target.bleValidationSide, "left");
  assert.equal(target.requiredCfwMarker, undefined);
});

test("exact OpenCFW recovery artifact passes parser and Bluetooth topology gate", async (t) => {
  const path = "/Users/kalani/Repo/evenRealities-openCFW/build/simota/opencfw-main-recovery-1101.evenota";
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    t.skip("local OpenCFW recovery artifact is unavailable");
    return;
  }
  const firmware = await parseFirmwareInput(bytes, path);
  assert.equal(firmware.fileSha256, IMAGE_SHA);
  assert.equal(firmware.mainComponent.payloadSha256, MAIN_SHA);
  assert.equal(firmware.templeFlashEligible, true);
  assert.equal(firmware.templeFlashTarget.recoveryExperiment, "apollo510-mram-sbl-early-arm");
  assert.deepEqual(firmware.templeFlashTarget.bleComponentNames, ["ota/s200_firmware_ota.bin"]);
  assert.equal(firmware.templeFlashTarget.bleValidationSide, "left");
  assert.equal(assertPinnedG2BleBundle(firmware), firmware);
});
