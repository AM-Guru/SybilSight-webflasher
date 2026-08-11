import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBundleDifferencePlan,
  describeByteDifferences,
  findStockCfwCounterpartRelease,
} from "../src/lib/differential.js";
import { operationProgress } from "../src/lib/operationProgress.js";
import { TEMPLE_FLASH_TARGETS } from "../src/lib/templeFlashTargets.js";

const cfwTarget = TEMPLE_FLASH_TARGETS.find(
  (target) => target.version === "2.2.8.9" && target.label.includes("CFW"),
);
const stockTarget = TEMPLE_FLASH_TARGETS.find(
  (target) =>
    target.version === "2.2.8.4" && target.label.startsWith("Stock"),
);

function component(name, typeId, payload, sha256) {
  return {
    name,
    typeId,
    payload: new Uint8Array(payload),
    payloadSize: payload.length,
    payloadSha256: sha256,
    header: new Uint8Array(128),
  };
}

function firmware(target, channel, mainPayload, mainDigest) {
  const shared = [
    component("firmware/codec.bin", 4, [1, 2], "codec"),
    component("firmware/ble_em9305.bin", 5, [3], "ble"),
    component("firmware/touch.bin", 3, [4], "touch"),
    component("firmware/box.bin", 6, [5], "box"),
    component("ota/s200_bootloader.bin", 1, [6], "boot"),
  ];
  const main = component(
    "ota/s200_firmware_ota.bin",
    0,
    mainPayload,
    mainDigest,
  );
  return {
    kind: "bundle",
    fileSha256: target.imageSha256,
    g2Version: target.version,
    provenance: {
      channel,
      baseVersion: channel === "custom" ? "2.2.8.4" : null,
    },
    componentImages: [...shared, main],
    mainComponent: main,
    templeFlashTarget: target,
  };
}

test("summarizes exact byte-difference ranges without inventing sparse writes", () => {
  const result = describeByteDifferences(
    new Uint8Array([1, 2, 3, 4, 5]),
    new Uint8Array([1, 9, 3, 8, 5, 6]),
  );
  assert.equal(result.changedBytes, 3);
  assert.equal(result.rangeCount, 3);
  assert.deepEqual(
    result.ranges.map(({ offset, length }) => ({ offset, length })),
    [
      { offset: 1, length: 1 },
      { offset: 3, length: 1 },
      { offset: 5, length: 1 },
    ],
  );
});

test("builds an executable Stock-to-CFW component-difference plan", () => {
  const source = firmware(
    stockTarget,
    "official",
    new Uint8Array(stockTarget.mainBytes).fill(0x11),
    stockTarget.mainSha256,
  );
  const target = firmware(
    cfwTarget,
    "custom",
    new Uint8Array(cfwTarget.mainBytes).fill(0x22),
    cfwTarget.mainSha256,
  );
  const plan = buildBundleDifferencePlan(source, target);
  assert.equal(plan.executable, true);
  assert.equal(plan.changedComponentCount, 1);
  assert.equal(plan.unchangedComponentCount, 5);
  assert.equal(plan.wireTransfer.sparseByteRangesSupported, false);
  assert.equal(plan.wireTransfer.bytes, cfwTarget.mainBytes);
  assert.equal(plan.verification.finalDualTempleResetRequired, true);
});

test("finds the exact opposite Stock/CFW catalog release", () => {
  const catalog = [
    { channel: "custom", baseVersion: "2.2.8.4", id: "cfw" },
    { channel: "official", version: "2.2.8.4", id: "stock" },
  ];
  const target = {
    templeFlashTarget: cfwTarget,
    provenance: { channel: "custom", baseVersion: "2.2.8.4" },
  };
  assert.equal(findStockCfwCounterpartRelease(catalog, target).id, "stock");
});

test("maps normalized progress to operation counts", () => {
  assert.deepEqual(operationProgress("backup", 0.42), {
    fraction: 0.42,
    total: 10,
    completed: 4,
    current: 5,
    percent: 42,
  });
  assert.equal(operationProgress("backup", 1).current, 10);
  assert.equal(operationProgress("backup", 1).completed, 10);
});
