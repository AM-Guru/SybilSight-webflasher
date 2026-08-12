import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { unzipSync } from "fflate";
import {
  R1_UNLOCK_APPLICATION_VERSION,
  R1_UNLOCK_ACE_RECORD_SHA256,
  R1_UNLOCK_OPTIONAL_IMAGE_SHA256,
  R1_UNLOCK_OWNER_IMAGE_SHA256,
  R1_UNLOCK_OWNER_KEY_SHA256,
  R1_UNLOCK_OWNER_PUBLIC_KEY_HEX,
  R1_UNLOCK_REVIEW,
  R1_UNLOCK_STOCK_KEY_SHA256,
  assertMatchingR1DfuIdentity,
  buildR1UnlockRecord,
  validateR1UnlockArtifactStructure,
  verifyR1OwnerInitPacket,
} from "../src/lib/r1Unlock.js";

const artifact = (name) => new URL(
  `../public/firmware-updates/local-r1-owner-unlock/${name}`,
  import.meta.url,
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("R1 unlock artifacts retain their reviewed byte identities", async () => {
  const key = await readFile(artifact("r1-owner-public-x-y-le.bin"));
  const ownerArchive = await readFile(artifact("r1-bootloader-owner-keyed.zip"));
  const optionalArchive = await readFile(
    artifact("r1-bootloader-owner-keyed-signing-optional.zip"),
  );
  assert.equal(R1_UNLOCK_APPLICATION_VERSION, "2.2.7.0005");
  assert.equal(sha256(key), R1_UNLOCK_OWNER_KEY_SHA256);
  assert.equal(sha256(ownerArchive),
    "dcbb12398e911c57eda88c3e6414b0edb543d1b83b233d9ff4032e9a97c5cea9");
  assert.equal(sha256(optionalArchive),
    "4e64f55d18394627a89db3174fa1c1f824858857c4c344189073ee3e696ab49b");
  assert.equal(sha256(unzipSync(ownerArchive)["bootloader.bin"]),
    R1_UNLOCK_OWNER_IMAGE_SHA256);
  assert.equal(sha256(unzipSync(optionalArchive)["bootloader.bin"]),
    R1_UNLOCK_OPTIONAL_IMAGE_SHA256);
  assert.equal(R1_UNLOCK_STOCK_KEY_SHA256,
    "e3cf089455dd88548fdc8336feb30212ce384deef9c54843313b9226e38c6b13");

  const ownerMembers = unzipSync(ownerArchive);
  const optionalMembers = unzipSync(optionalArchive);
  const owner = { application: ownerMembers["bootloader.bin"] };
  const optional = { application: optionalMembers["bootloader.bin"] };
  validateR1UnlockArtifactStructure(new Uint8Array(key), owner, optional);
  await verifyR1OwnerInitPacket(ownerMembers["bootloader.dat"], new Uint8Array(key));
  await verifyR1OwnerInitPacket(optionalMembers["bootloader.dat"], new Uint8Array(key));
  assert.equal(Buffer.from(key).toString("hex"), R1_UNLOCK_OWNER_PUBLIC_KEY_HEX);
  const changed = [];
  owner.application.forEach((value, index) => {
    if (value !== optional.application[index]) changed.push(index);
  });
  assert.deepEqual(changed, [R1_UNLOCK_REVIEW.signatureGateOffset,
    R1_UNLOCK_REVIEW.signatureGateOffset + 1]);
  assert.equal(Buffer.from(owner.application.subarray(
    R1_UNLOCK_REVIEW.publicKeyOffset,
    R1_UNLOCK_REVIEW.publicKeyOffset + R1_UNLOCK_REVIEW.publicKeyBytes,
  )).toString("hex"), R1_UNLOCK_OWNER_PUBLIC_KEY_HEX);
});

test("browser ACE records are byte-identical to the reviewed Python builder", async () => {
  const key = new Uint8Array(await readFile(artifact("r1-owner-public-x-y-le.bin")));
  const cases = [
    ["enter-dfu", {}, "8edb2ed70f8298c0a8fb91340f30e19b9734e172811fb2b6e224360aa27aa375"],
    ["fpb-retention-arm", {}, "39526d8f6d80c0b1e0ad1632ea1ceb29263d146e519e76d7876cff3c37f13615"],
    ["fpb-retention-check", {}, "1235406488fb504c6a864c2179d886c4e6fc163bddb3a38e367b4fbebc1c12ed"],
    ["fpb-key-stage", { ownerKey: key }, "9dbc5cefe4a3239313a25fb51bfe437e63ac212d060c35cedf2319fbcb77dba2"],
    ["fpb-key-arm", {}, "f565156350ea5d804fc15a3aa1a1bab4f7b65fcc82e32bc0667a7c803e8dc77b"],
    ["fpb-key-cleanup", {}, "691c1c26868687edbccd44315061b62c4c4c163951bbd407ad902f5061899cbf"],
    ["read-prefix", { address: 0xfbd98 }, "31b8ee2fc406672980c291b2eb9d9216fbc97637952a7b92a76f886cebf51a58"],
    ["read-page", { address: 0xf8000 }, "81fd9087c8192d46d352dbf65da566c42a773a129e47feef0ed68e55a20e2164"],
  ];
  for (const [mode, options, digest] of cases) {
    const record = buildR1UnlockRecord(mode, options);
    assert.equal(record.length, 244, mode);
    assert.equal(sha256(record), digest, mode);
  }
  for (const [mode, digest] of Object.entries(R1_UNLOCK_ACE_RECORD_SHA256)) {
    assert.equal(sha256(buildR1UnlockRecord(mode, { ownerKey: key })), digest, mode);
  }
});

test("R1 bootloader reads reject targets outside the reviewed flash window", () => {
  assert.throws(() => buildR1UnlockRecord("read-prefix", { address: 0xf7fff }), /outside/);
  assert.throws(() => buildR1UnlockRecord("read-page", { address: 0xf8001 }), /outside/);
  assert.throws(() => buildR1UnlockRecord("read-page", { address: 0xfe000 }), /outside/);
});

test("R1 unlock binds the pre-authorized DFU identity to the application suffix", () => {
  const application = { name: "EVEN R1_B56EE2" };
  const dfu = { name: "R1 DFU_B56EE3" };
  assert.equal(assertMatchingR1DfuIdentity(application, dfu), dfu);
  assert.throws(
    () => assertMatchingR1DfuIdentity(application, { name: "R1 DFU_B56EE4" }),
    /does not match/,
  );
  assert.throws(
    () => assertMatchingR1DfuIdentity(application, { name: "EVEN R1_B56EE3" }),
    /does not match/,
  );
});
