import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseFirmwareInput, classifyG2Firmware } from "../src/lib/firmware.js";
import { findTempleFlashTarget } from "../src/lib/templeFlashTargets.js";
import { G2_CFW_IDENTITY_MARKER as marker, makeG2CfwIdentityQuery,
  parseG2CfwIdentity, probeG2CfwIdentity } from "../src/lib/g2CfwIdentity.js";
import { applyG2BleReselectionProof, g2BleRouteProvenOverBluetooth,
  g2BleRoutesAwaitingCaseVerification, G2BleOtaSession,
  crc16CcittFalse, assertPinnedG2BleBundle } from "../src/lib/g2BleOta.js";

const candidateDigest = "bbb334bad754826f8d4397505adc23f9177931f46ed7d6192a680a7f59637c48";
test("published 230.85 keyboard CFW requires fresh bilateral identity", () => {
  const digest = "32d7304ce85304ba9f6e1c8f65d2812913e556ef5506582b016ea78c3f37c860";
  const target = findTempleFlashTarget(digest);
  assert.equal(target?.requiredCfwMarker, "SybilSight/230.85");
  assert.equal(target.mainSha256, "f0afde114bfb5cce70e712d6bb354b613de9110f5cd47e46ae7ff3fdf8f8c157");
  assert.equal(target.mainBytes, 3_888_182);
  assert.equal(target.localOnly, undefined);
  assert.equal(target.hardwareValidated, false);
  assert.equal(classifyG2Firmware(digest).trust, "reviewed-custom");
  for (const [side, code] of [["left", 2], ["right", 1]]) {
    const markerBytes = new TextEncoder().encode(target.requiredCfwMarker);
    const wire = Uint8Array.from([0x46, 0x49, 1, code, 7, 0, 0, 0, markerBytes.length, ...markerBytes]);
    assert.deepEqual(parseG2CfwIdentity(wire, { side, nonce: 7, marker: target.requiredCfwMarker }),
      { side, nonce: 7, marker: target.requiredCfwMarker });
    assert.equal(parseG2CfwIdentity(wire, { side, nonce: 7, marker: "SybilSight/230.84" }), null);
  }
});

test("real 230.85 bundle retains all six components without a hardware-validation claim", async () => {
  const firmware = await parseFirmwareInput(await readFile(new URL(
    "../public/firmware-updates/source-files/2.3.0.24-32d7304ce853/g2-2.3.0.24-sybilsight-230.85.bin", import.meta.url)));
  assertPinnedG2BleBundle(firmware);
  assert.equal(firmware.componentImages.length, 6);
  assert.equal(firmware.caseRecoveryEligible, false);
  assert.equal(firmware.templeFlashTarget.requiredCfwMarker, "SybilSight/230.85");
  assert.equal(firmware.templeFlashTarget.hardwareValidated, false);
});

test("retired published CFW pins remain inspectable but cannot be selected for a write", () => {
  for (const digest of [
    "8784efd8892a027dd2a0b7eee4dae1b1679cfa1b8008aa1b296103cfe674b0ba",
    "36cc6222227275d0fd07f134c765737e508b5e205e6d6aa1122a4b2cf1996bfa",
    "afa6c1da6bc1ba6b0904a438b6acb7f6e628b4fd53c82e1c58d71ba4a431f68b",
    "f3bd05f9adaae94cbf2a693b7259a98c11454ba270fe09311bdfd38484d1161c",
  ]) {
    assert.equal(classifyG2Firmware(digest).channel, "custom");
    assert.equal(findTempleFlashTarget(digest), null);
  }
});
test("230.25 PCM registry diagnostic stays local-only and requires bilateral identity", async () => {
  const digest = "f5562b636a77c260e950da4f872d1e94224159841b9cb6b9c47faab2818aded4";
  const target = findTempleFlashTarget(digest);
  assert.equal(target?.requiredCfwMarker, "SybilSight/230.25");
  assert.equal(target.mainSha256, "c3dee6cd7ebb06c9142c19314842d7ce8c2e800bfc140630356a2d0684b7f6b7");
  assert.equal(target.mainBytes, 3_838_184);
  assert.equal(target.localOnly, true);
  assert.equal(target.hardwareValidated, false);
  assert.equal(classifyG2Firmware(digest).trust, "experimental-local");
  for (const [side, code] of [["left", 2], ["right", 1]]) {
    const markerBytes = new TextEncoder().encode(target.requiredCfwMarker);
    const wire = Uint8Array.from([0x46, 0x49, 1, code, 7, 0, 0, 0, markerBytes.length,
      ...markerBytes]);
    assert.deepEqual(parseG2CfwIdentity(wire, {
      side, nonce: 7, marker: target.requiredCfwMarker,
    }), { side, nonce: 7, marker: target.requiredCfwMarker });
    assert.equal(parseG2CfwIdentity(wire, {
      side, nonce: 7, marker: "SybilSight/230.24",
    }), null);
  }
});
test("real 230.25 bundle retains six exact components without USB qualification", {
  skip: !process.env.G2_CFW_2325_FIXTURE,
}, async () => {
  const firmware = await parseFirmwareInput(new Uint8Array(await readFile(process.env.G2_CFW_2325_FIXTURE)));
  assert.equal(firmware.fileSha256, "f5562b636a77c260e950da4f872d1e94224159841b9cb6b9c47faab2818aded4");
  assertPinnedG2BleBundle(firmware);
  assert.equal(firmware.componentImages.length, 6);
  assert.equal(firmware.caseRecoveryEligible, false);
  assert.equal(firmware.templeFlashTarget.localOnly, true);
  assert.equal(firmware.templeFlashTarget.hardwareValidated, false);
});
test("230.24 stock mono diagnostic stays local-only and requires bilateral identity", async () => {
  const digest = "5449127b711fe90902582dd48e113d915420cf6ada3ead7daa75cfa2361ce2a7";
  const target = findTempleFlashTarget(digest);
  assert.equal(target?.requiredCfwMarker, "SybilSight/230.24");
  assert.equal(target.mainSha256, "74c0e3eaca22f3b336bf144ffd3c1ddcb3cdce6cb1e0ee764f997d86277b60a2");
  assert.equal(target.mainBytes, 3_838_048);
  assert.equal(target.localOnly, true);
  assert.equal(target.hardwareValidated, false);
  assert.equal(classifyG2Firmware(digest).trust, "experimental-local");
  for (const [side, code] of [["left", 2], ["right", 1]]) {
    const markerBytes = new TextEncoder().encode(target.requiredCfwMarker);
    const wire = Uint8Array.from([0x46, 0x49, 1, code, 7, 0, 0, 0, markerBytes.length,
      ...markerBytes]);
    assert.deepEqual(parseG2CfwIdentity(wire, {
      side, nonce: 7, marker: target.requiredCfwMarker,
    }), { side, nonce: 7, marker: target.requiredCfwMarker });
    assert.equal(parseG2CfwIdentity(wire, {
      side, nonce: 7, marker: "SybilSight/230.23",
    }), null);
  }
});
test("real 230.24 bundle retains six exact components without USB qualification", {
  skip: !process.env.G2_CFW_2324_FIXTURE,
}, async () => {
  const firmware = await parseFirmwareInput(new Uint8Array(await readFile(process.env.G2_CFW_2324_FIXTURE)));
  assert.equal(firmware.fileSha256, "5449127b711fe90902582dd48e113d915420cf6ada3ead7daa75cfa2361ce2a7");
  assertPinnedG2BleBundle(firmware);
  assert.equal(firmware.componentImages.length, 6);
  assert.equal(firmware.caseRecoveryEligible, false);
  assert.equal(firmware.templeFlashTarget.localOnly, true);
  assert.equal(firmware.templeFlashTarget.hardwareValidated, false);
});
test("230.23 stock PCM diagnostic stays local-only and requires bilateral identity", async () => {
  const digest = "df0358e5111ab509072e195d40c3cbd6e011928613fb8b6aaff85c6ef03ae316";
  const target = findTempleFlashTarget(digest);
  assert.equal(target?.requiredCfwMarker, "SybilSight/230.23");
  assert.equal(target.mainSha256, "d15ae1739269f1d6d1c9f6e8b4027dc0a743319db1bb7f9a27293ac2ad3919e6");
  assert.equal(target.mainBytes, 3_837_928);
  assert.equal(target.localOnly, true);
  assert.equal(target.hardwareValidated, false);
  assert.equal(classifyG2Firmware(digest).trust, "experimental-local");
  for (const [side, code] of [["left", 2], ["right", 1]]) {
    const markerBytes = new TextEncoder().encode(target.requiredCfwMarker);
    const wire = Uint8Array.from([0x46, 0x49, 1, code, 7, 0, 0, 0, markerBytes.length,
      ...markerBytes]);
    assert.deepEqual(parseG2CfwIdentity(wire, {
      side, nonce: 7, marker: target.requiredCfwMarker,
    }), { side, nonce: 7, marker: target.requiredCfwMarker });
    assert.equal(parseG2CfwIdentity(wire, {
      side, nonce: 7, marker: "SybilSight/230.22",
    }), null);
  }
});
test("real 230.23 bundle retains six exact components without USB qualification", {
  skip: !process.env.G2_CFW_2323_FIXTURE,
}, async () => {
  const firmware = await parseFirmwareInput(new Uint8Array(await readFile(process.env.G2_CFW_2323_FIXTURE)));
  assert.equal(firmware.fileSha256, "df0358e5111ab509072e195d40c3cbd6e011928613fb8b6aaff85c6ef03ae316");
  assertPinnedG2BleBundle(firmware);
  assert.equal(firmware.componentImages.length, 6);
  assert.equal(firmware.caseRecoveryEligible, false);
  assert.equal(firmware.templeFlashTarget.localOnly, true);
  assert.equal(firmware.templeFlashTarget.hardwareValidated, false);
});
test("230.22 PCM-state diagnostic stays local-only and requires fresh bilateral identity", async () => {
  const digest = "10f047dab6fe551e29cfe885bf279da5e564331bcd8205a000a376f84bfc79b8";
  const target = findTempleFlashTarget(digest);
  assert.equal(target?.requiredCfwMarker, "SybilSight/230.22");
  assert.equal(target.mainSha256, "22f7e357690582787975178f78965d8c48f54eabc57cd5c81e8cc85458415894");
  assert.equal(target.mainBytes, 3_837_680);
  assert.equal(target.localOnly, true);
  assert.equal(target.hardwareValidated, false);
  assert.equal(classifyG2Firmware(digest).trust, "experimental-local");
  for (const [side, code] of [["left", 2], ["right", 1]]) {
    const markerBytes = new TextEncoder().encode(target.requiredCfwMarker);
    const wire = Uint8Array.from([0x46, 0x49, 1, code, 7, 0, 0, 0, markerBytes.length,
      ...markerBytes]);
    assert.deepEqual(parseG2CfwIdentity(wire, {
      side, nonce: 7, marker: target.requiredCfwMarker,
    }), { side, nonce: 7, marker: target.requiredCfwMarker });
    assert.equal(parseG2CfwIdentity(wire, {
      side, nonce: 7, marker: "SybilSight/230.21",
    }), null);
  }
});
test("real 230.22 bundle retains six exact components and no USB qualification", {
  skip: !process.env.G2_CFW_2322_FIXTURE,
}, async () => {
  const firmware = await parseFirmwareInput(new Uint8Array(await readFile(process.env.G2_CFW_2322_FIXTURE)));
  assert.equal(firmware.fileSha256, "10f047dab6fe551e29cfe885bf279da5e564331bcd8205a000a376f84bfc79b8");
  assertPinnedG2BleBundle(firmware);
  assert.equal(firmware.componentImages.length, 6);
  assert.equal(firmware.caseRecoveryEligible, false);
  assert.equal(firmware.templeFlashTarget.localOnly, true);
  assert.equal(firmware.templeFlashTarget.hardwareValidated, false);
});
test("230.21 I2S diagnostic remains local-only with exact bilateral identity", async () => {
  const digest = "c6ecd1cfc3acb72099cf2faf794d6fa895d5f0c1d70d37df2c2579fd925b927d";
  const target = findTempleFlashTarget(digest);
  assert.equal(target?.requiredCfwMarker, "SybilSight/230.21");
  assert.equal(target.mainSha256, "94a78d4f28a90796c5ab6257735042974eb54cef8dc4b422ca794937cd4f4967");
  assert.equal(target.mainBytes, 3_837_516);
  assert.equal(target.localOnly, true);
  assert.equal(target.hardwareValidated, false, "native OTA success does not qualify Case USB writing");
  assert.equal(classifyG2Firmware(digest).trust, "experimental-local");
  for (const [side, code] of [["left", 2], ["right", 1]]) {
    const markerBytes = new TextEncoder().encode(target.requiredCfwMarker);
    const wire = Uint8Array.from([0x46, 0x49, 1, code, 7, 0, 0, 0, markerBytes.length,
      ...markerBytes]);
    assert.deepEqual(parseG2CfwIdentity(wire, {
      side, nonce: 7, marker: target.requiredCfwMarker,
    }), { side, nonce: 7, marker: target.requiredCfwMarker });
    assert.equal(parseG2CfwIdentity(wire, {
      side, nonce: 7, marker: "SybilSight/230.19",
    }), null);
  }
});
test("real 230.21 bundle preserves six pinned components without USB qualification", {
  skip: !process.env.G2_CFW_2321_FIXTURE,
}, async () => {
  const firmware = await parseFirmwareInput(new Uint8Array(await readFile(process.env.G2_CFW_2321_FIXTURE)));
  assert.equal(firmware.fileSha256, "c6ecd1cfc3acb72099cf2faf794d6fa895d5f0c1d70d37df2c2579fd925b927d");
  assertPinnedG2BleBundle(firmware);
  assert.equal(firmware.componentImages.length, 6);
  assert.equal(firmware.caseRecoveryEligible, false);
  assert.equal(firmware.templeFlashTarget.localOnly, true);
  assert.equal(firmware.templeFlashTarget.hardwareValidated, false);
});
test("230.19 pre-LC3 probe has exact local pins and bilateral nonce identity", async () => {
  const digest = "0073690b9a73c26d9297ed1fb790ad37c1554cf8dca757308e26448e292e860c";
  const target = findTempleFlashTarget(digest);
  assert.equal(target?.requiredCfwMarker, "SybilSight/230.19");
  assert.equal(target.mainSha256, "9277c9a52bbb381fdd0944400ccb4de276954bcb6a9ba57d449b7f957beb6302");
  assert.equal(target.mainBytes, 3_840_540);
  assert.equal(target.localOnly, true);
  assert.equal(target.hardwareValidated, false);
  assert.equal(classifyG2Firmware(digest).trust, "experimental-local");
  for (const [side, code] of [["left", 2], ["right", 1]]) {
    const wire = Uint8Array.from([0x46, 0x49, 1, code, 7, 0, 0, 0, 17,
      ...new TextEncoder().encode(target.requiredCfwMarker)]);
    assert.deepEqual(parseG2CfwIdentity(wire, {
      side, nonce: 7, marker: target.requiredCfwMarker,
    }), { side, nonce: 7, marker: target.requiredCfwMarker });
    assert.equal(parseG2CfwIdentity(wire, {
      side, nonce: 7, marker: "SybilSight/230.18",
    }), null);
  }
});
test("real 230.19 probe package keeps all six pinned components", {
  skip: !process.env.G2_CFW_2319_FIXTURE,
}, async () => {
  const firmware = await parseFirmwareInput(new Uint8Array(await readFile(process.env.G2_CFW_2319_FIXTURE)));
  assert.equal(firmware.fileSha256, "0073690b9a73c26d9297ed1fb790ad37c1554cf8dca757308e26448e292e860c");
  assertPinnedG2BleBundle(firmware);
  assert.equal(firmware.componentImages.length, 6);
  assert.equal(firmware.caseRecoveryEligible, false);
  assert.equal(firmware.templeFlashTarget.localOnly, true);
});
test("codec-lifecycle candidate has a separate pin and exact identity", async () => {
  const digest = "6349192de1744319ee78a7b85f77664f6cf80f4df9664fa01dd9f59746178da6";
  const target = findTempleFlashTarget(digest);
  assert.equal(target.requiredCfwMarker, "SybilSight/230.11");
  assert.equal(target.localOnly, true);
  assert.equal(target.hardwareValidated, true, "230.11 completed bilateral Case USB transfer; local experimental trust is unchanged");
  assert.equal(classifyG2Firmware(digest).trust, "experimental-local");
  const wire = Uint8Array.from([0x46,0x49,1,2,1,0,0,0,17,
    ...new TextEncoder().encode(target.requiredCfwMarker)]);
  assert.equal(parseG2CfwIdentity(wire, { side: "left", nonce: 1, marker: target.requiredCfwMarker })?.marker, target.requiredCfwMarker);
  assert.equal(parseG2CfwIdentity(wire, { side: "left", nonce: 1, marker }), null);
  assert.equal(parseG2CfwIdentity(wire, { side: "left", nonce: 1, marker: "SybilSight/230.12" }), null);
  if (process.env.G2_CFW_2311_FIXTURE) {
    const firmware = await parseFirmwareInput(await readFile(process.env.G2_CFW_2311_FIXTURE));
    assert.equal(firmware.fileSha256, digest);
    assert.equal(firmware.componentImages.length, 6);
    assert.doesNotThrow(() => assertPinnedG2BleBundle(firmware));
  }
});
test("230.12 has independent pins and requires its exact physical identity", async () => {
  const digest = "e7fe637d7ee5ce889976ee4f82a1bb9c67a50bd3a33ce98be7c373a8cc546553";
  const target = findTempleFlashTarget(digest);
  assert.equal(target.requiredCfwMarker, "SybilSight/230.12");
  assert.equal(target.localOnly, true);
  assert.equal(target.hardwareValidated, false);
  assert.equal(classifyG2Firmware(digest).trust, "experimental-local");
  const wire = Uint8Array.from([0x46,0x49,1,1,7,0,0,0,17,
    ...new TextEncoder().encode(target.requiredCfwMarker)]);
  const expected = { side: "right", nonce: 7, marker: target.requiredCfwMarker };
  assert.deepEqual(parseG2CfwIdentity(wire, expected), expected);
  for (const wrong of [marker, "SybilSight/230.11", "SybilSight/230.13"]) {
    assert.equal(parseG2CfwIdentity(wire, { ...expected, marker: wrong }), null);
  }
  assert.equal(parseG2CfwIdentity(wire, { ...expected, side: "left" }), null);
  assert.equal(parseG2CfwIdentity(wire, { ...expected, nonce: 8 }), null);
});
test("real 230.12 candidate validates every component without gaining public or USB qualification", {
  skip: !process.env.G2_CFW_2312_FIXTURE,
}, async () => {
  const firmware = await parseFirmwareInput(new Uint8Array(await readFile(process.env.G2_CFW_2312_FIXTURE)));
  assert.equal(firmware.fileSha256, "e7fe637d7ee5ce889976ee4f82a1bb9c67a50bd3a33ce98be7c373a8cc546553");
  assertPinnedG2BleBundle(firmware);
  assert.equal(firmware.componentImages.length, 6);
  assert.equal(firmware.caseRecoveryEligible, false);
  assert.equal(firmware.templeFlashTarget.mainBytes, 3813316);
  assert.equal(firmware.templeFlashTarget.mainSha256, "0bce60ecbdd906e66d16a5afd069f491c6baacb64dec0ea54c3d149f578e9e35");
  assert.equal(firmware.templeFlashTarget.hardwareValidated, false);
  assert.equal(firmware.templeFlashTarget.localOnly, true);
});
test("230.13 has independent pins and requires its exact physical identity", async () => {
  const digest = "527336e6c91158148f1c44be498895abcdf66ed8604de896e576e04f9517fbf9";
  const target = findTempleFlashTarget(digest);
  assert.equal(target.requiredCfwMarker, "SybilSight/230.13");
  assert.equal(target.localOnly, true);
  assert.equal(target.hardwareValidated, false);
  assert.equal(classifyG2Firmware(digest).trust, "experimental-local");
  const wire = Uint8Array.from([0x46,0x49,1,1,7,0,0,0,17,
    ...new TextEncoder().encode(target.requiredCfwMarker)]);
  const expected = { side: "right", nonce: 7, marker: target.requiredCfwMarker };
  assert.deepEqual(parseG2CfwIdentity(wire, expected), expected);
  for (const wrong of [marker, "SybilSight/230.12", "SybilSight/230.14"]) {
    assert.equal(parseG2CfwIdentity(wire, { ...expected, marker: wrong }), null);
  }
  assert.equal(parseG2CfwIdentity(wire, { ...expected, side: "left" }), null);
  assert.equal(parseG2CfwIdentity(wire, { ...expected, nonce: 8 }), null);
});
test("real 230.13 candidate validates every component without gaining public or USB qualification", {
  skip: !process.env.G2_CFW_2313_FIXTURE,
}, async () => {
  const firmware = await parseFirmwareInput(new Uint8Array(await readFile(process.env.G2_CFW_2313_FIXTURE)));
  assert.equal(firmware.fileSha256, "527336e6c91158148f1c44be498895abcdf66ed8604de896e576e04f9517fbf9");
  assertPinnedG2BleBundle(firmware);
  assert.equal(firmware.componentImages.length, 6);
  assert.equal(firmware.caseRecoveryEligible, false);
  assert.equal(firmware.templeFlashTarget.mainBytes, 3813772);
  assert.equal(firmware.templeFlashTarget.mainSha256, "170d2c33acdb550f881572b1eed68c503fc7aff9f558c996b5fb41c0239e8afa");
  assert.equal(firmware.templeFlashTarget.hardwareValidated, false);
  assert.equal(firmware.templeFlashTarget.localOnly, true);
});
test("230.14 has independent pins and requires its exact physical identity", async () => {
  const digest = "1d45f689eb7d39e5e4fec733bd30966a2659b00e906fc2814d6e22061fcc2c75";
  const target = findTempleFlashTarget(digest);
  assert.equal(target.requiredCfwMarker, "SybilSight/230.14");
  assert.equal(target.localOnly, true);
  assert.equal(target.hardwareValidated, false);
  assert.equal(classifyG2Firmware(digest).trust, "experimental-local");
  const wire = Uint8Array.from([0x46,0x49,1,1,7,0,0,0,17,
    ...new TextEncoder().encode(target.requiredCfwMarker)]);
  const expected = { side: "right", nonce: 7, marker: target.requiredCfwMarker };
  assert.deepEqual(parseG2CfwIdentity(wire, expected), expected);
  for (const wrong of [marker, "SybilSight/230.12", "SybilSight/230.15"]) {
    assert.equal(parseG2CfwIdentity(wire, { ...expected, marker: wrong }), null);
  }
  assert.equal(parseG2CfwIdentity(wire, { ...expected, side: "left" }), null);
  assert.equal(parseG2CfwIdentity(wire, { ...expected, nonce: 8 }), null);
});
test("real 230.14 candidate validates every component without gaining public or USB qualification", {
  skip: !process.env.G2_CFW_2314_FIXTURE,
}, async () => {
  const firmware = await parseFirmwareInput(new Uint8Array(await readFile(process.env.G2_CFW_2314_FIXTURE)));
  assert.equal(firmware.fileSha256, "1d45f689eb7d39e5e4fec733bd30966a2659b00e906fc2814d6e22061fcc2c75");
  assertPinnedG2BleBundle(firmware);
  assert.equal(firmware.componentImages.length, 6);
  assert.equal(firmware.caseRecoveryEligible, false);
  assert.equal(firmware.templeFlashTarget.mainBytes, 3813992);
  assert.equal(firmware.templeFlashTarget.mainSha256, "217756cc297ff677156a6ca04aa1e964bdf26c20df3ae298e988b29e7d4582af");
  assert.equal(firmware.templeFlashTarget.hardwareValidated, false);
  assert.equal(firmware.templeFlashTarget.localOnly, true);
});
test("230.10 remains an explicit local experimental pin", () => {
  const target = findTempleFlashTarget(candidateDigest);
  assert.equal(target.localOnly, true);
  assert.equal(target.hardwareValidated, false);
  assert.equal(target.requiredCfwMarker, marker);
  assert.equal(classifyG2Firmware(candidateDigest).trust, "experimental-local");
  assert.equal(classifyG2Firmware(candidateDigest).channel, "custom");
});
test("real local candidate retains all six validated components", {
  skip: !process.env.G2_CFW_2310_FIXTURE,
}, async () => {
  const firmware = await parseFirmwareInput(new Uint8Array(await readFile(process.env.G2_CFW_2310_FIXTURE)));
  assert.equal(firmware.fileSha256, candidateDigest);
  assertPinnedG2BleBundle(firmware);
  assert.equal(firmware.componentImages.length, 6);
  assert.equal(firmware.caseRecoveryEligible, false);
  assert.equal(firmware.templeFlashTarget.requiredCfwMarker, marker);
});

function reply(side = "left", nonce = 0x89abcdef) {
  const bytes = new Uint8Array(26);
  bytes.set([0x46, 0x49, 1, side === "left" ? 2 : 1]);
  new DataView(bytes.buffer).setUint32(4, nonce, true);
  bytes[8] = 17; bytes.set(new TextEncoder().encode(marker), 9);
  return bytes;
}
const expected = { side: "left", nonce: 0x89abcdef, marker };
test("identity rejects stock, stale, relayed and malformed replies", () => {
  assert.deepEqual(parseG2CfwIdentity(reply(), expected), expected);
  for (const bytes of [reply("right"), reply("left", 7), reply().slice(0, 25),
    Uint8Array.from([...reply(), 0]), new TextEncoder().encode("2.3.0.24")]) {
    assert.equal(parseG2CfwIdentity(bytes, expected), null);
  }
  for (const index of [0, 1, 2, 3, 8, 25]) {
    const bytes = reply(); bytes[index] ^= 0x10;
    assert.equal(parseG2CfwIdentity(bytes, expected), null);
  }
  assert.equal(parseG2CfwIdentity(reply(), { ...expected, nonce: 0 }), null);
  assert.equal(parseG2CfwIdentity(reply(), { ...expected, marker: "SybilSight/230.11" }), null);
  const padded = new Uint8Array(32); padded.set(reply(), 3);
  assert.deepEqual(parseG2CfwIdentity(new DataView(padded.buffer, 3, 26), expected), expected);
});
test("query is stateless MC op 5 and refuses invalid nonces", () => {
  assert.deepEqual([...makeG2CfwIdentityQuery(expected.nonce)], [77, 67, 1, 5, 239, 205, 171, 137]);
  for (const nonce of [0, -1, 1.5, 0x100000000, NaN]) assert.throws(() => makeG2CfwIdentityQuery(nonce));
});
function peripheral() {
  const notify = new EventTarget();
  let starts = 0, stops = 0, listeners = 0;
  const add = notify.addEventListener.bind(notify), remove = notify.removeEventListener.bind(notify);
  notify.addEventListener = (...args) => { listeners++; add(...args); };
  notify.removeEventListener = (...args) => { listeners--; remove(...args); };
  notify.startNotifications = async () => { starts++; };
  notify.stopNotifications = async () => { stops++; };
  const server = { getPrimaryService: async () => ({ getCharacteristic: async () => notify }) };
  const send = (bytes) => {
    notify.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    notify.dispatchEvent(new Event("characteristicvaluechanged"));
  };
  return { server, send, counts: () => ({ starts, stops, listeners }) };
}
test("read-only probe catches immediate physical reply and cleans up", async () => {
  const p = peripheral();
  const proof = await probeG2CfwIdentity({ ...p, side: "left", marker,
    cryptoObject: { getRandomValues: (a) => { a[0] = expected.nonce; return a; } },
    writeQuery: async (query) => { assert.equal(query[3], 5); p.send(reply("right")); p.send(reply()); },
  });
  assert.equal(proof.marker, marker);
  assert.equal(proof.nonce, expected.nonce);
  assert.deepEqual(p.counts(), { starts: 1, stops: 1, listeners: 0 });
});
test("missing proof times out; write failure cleans up without replay", async () => {
  for (const writeQuery of [async () => {}, async () => { throw new Error("write failed"); }]) {
    const p = peripheral();
    await assert.rejects(probeG2CfwIdentity({ ...p, side: "left", marker, timeoutMs: 5, writeQuery }));
    assert.deepEqual(p.counts(), { starts: 1, stops: 1, listeners: 0 });
  }
});
test("session sends identity through reserved settings envelope without OTA or mic enable", async () => {
  const p = peripheral();
  const session = new G2BleOtaSession({ name: "Even G2_32_L_ABCDEF" }, { side: "left" });
  session.server = p.server;
  await assert.rejects(session.verifyCFWIdentity(marker), /Authenticate/);
  session.linkAuthenticated = true;
  session.writeFrames = async (_characteristic, frames) => {
    assert.equal(frames.length, 1);
    const frame = frames[0];
    assert.deepEqual([...frame.slice(0, 2)], [0xaa, 0x21]);
    const envelope = { sid: frame[6], flag: frame[7], payload: frame.slice(8, -2) };
    assert.equal(frame.at(-2) | (frame.at(-1) << 8), crc16CcittFalse(envelope.payload));
    assert.equal(envelope.sid, 9); assert.equal(envelope.flag, 0x20);
    assert.deepEqual([...envelope.payload.slice(0, 11)], [8, 1, 16, 0, 186, 6, 8, 77, 67, 1, 5]);
    const nonce = new DataView(envelope.payload.buffer, envelope.payload.byteOffset + 11, 4).getUint32(0, true);
    p.send(reply("left", nonce));
  };
  assert.equal((await session.verifyCFWIdentity(marker)).marker, marker);
});
test("base-version reselection cannot upgrade CFW transfer into qualified success", () => {
  const route = { side: "left", outcome: "success", requiredCfwMarker: marker,
    components: [{ postUpdate: { freshReconnectAttempted: true, reconnected: true } }] };
  const routes = { left: route };
  assert.equal(g2BleRouteProvenOverBluetooth(route), false);
  assert.deepEqual(g2BleRoutesAwaitingCaseVerification(routes), ["left"]);
  assert.equal(applyG2BleReselectionProof(routes, "left", { firmwareRevision: "2.3.0.24" }), routes);
  const proven = applyG2BleReselectionProof(routes, "left", { cfwIdentity: expected });
  assert.equal(g2BleRouteProvenOverBluetooth(proven.left), true);
  assert.deepEqual(g2BleRoutesAwaitingCaseVerification(proven), []);
});

for (const candidate of [
  { revision: 17, digest: "1e0dfdb6d012947ea3efa6b0742c2ea5e8093a313e4bebe8b82b7077bc6d8561", bytes: 3819500,
    main: "7ac1aa03ac54d89698344160a73512672d018069dd6e13bee559e3bff3dd4417" },
  { revision: 18, digest: "01d5e44cdf0802cf4d87639c079ddb05280d2b82f44d48dc3c1374e15f60a7ab", bytes: 3840292,
    main: "cc8f4453f5642925e3841f12fc48c4f1c49cec02891756f0f7955f0ef54f6bc6" },
]) {
  const exactMarker = `SybilSight/230.${candidate.revision}`;
  test(`${exactMarker} requires an exact per-lens identity without public qualification`, () => {
    const target = findTempleFlashTarget(candidate.digest);
    assert.equal(target.requiredCfwMarker, exactMarker);
    assert.equal(target.localOnly, true);
    assert.equal(target.hardwareValidated, false);
    assert.equal(classifyG2Firmware(candidate.digest).trust, "experimental-local");
    for (const side of ["left", "right"]) {
      const wire = Uint8Array.from([0x46, 0x49, 1, side === "left" ? 2 : 1, 7, 0, 0, 0, 17,
        ...new TextEncoder().encode(exactMarker)]);
      const expected = { side, nonce: 7, marker: exactMarker };
      assert.deepEqual(parseG2CfwIdentity(wire, expected), expected);
      for (const other of [14, 16, 17, 18, 19].filter((revision) => revision !== candidate.revision)) {
        assert.equal(parseG2CfwIdentity(wire, { ...expected, marker: `SybilSight/230.${other}` }), null);
      }
      assert.equal(parseG2CfwIdentity(wire, { ...expected, nonce: 8 }), null);
      assert.equal(parseG2CfwIdentity(wire, { ...expected, side: side === "left" ? "right" : "left" }), null);
    }
  });
  const fixture = process.env[`G2_CFW_23${candidate.revision}_FIXTURE`];
  test(`real ${exactMarker} package validates all six components and rejects mutation`, { skip: !fixture }, async () => {
    const data = new Uint8Array(await readFile(fixture));
    const firmware = await parseFirmwareInput(data);
    assert.equal(firmware.fileSha256, candidate.digest);
    assertPinnedG2BleBundle(firmware);
    assert.equal(firmware.componentImages.length, 6);
    assert.equal(firmware.caseRecoveryEligible, false);
    assert.equal(firmware.templeFlashTarget.requiredCfwMarker, exactMarker);
    assert.equal(firmware.templeFlashTarget.mainBytes, candidate.bytes);
    assert.equal(firmware.templeFlashTarget.mainSha256, candidate.main);
    const mutation = data.slice();
    mutation[mutation.length - 1] ^= 1;
    await assert.rejects(async () => assertPinnedG2BleBundle(await parseFirmwareInput(mutation)));
  });
}
