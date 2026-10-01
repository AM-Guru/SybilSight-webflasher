import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FirmwareCatalogCoverageError,
  assertFirmwareCatalogCoversPinnedImages,
  compareFirmwareVersions,
  findUnservedPinnedImages,
  parseFirmwareVersion,
} from "../src/lib/catalogCoverage.js";
import { TEMPLE_FLASH_TARGETS } from "../src/lib/templeFlashTargets.js";

const LEGACY_CFW_SHA256 =
  "5c1539fd39c599e6035f6a8ec0779ba687c250d342a24c21a39952fed6c56aa0";
const SUPERSEDED_ADVERTISED_CFW_2_2_8_7_SHA256 =
  "e9d9e8b30d5f240fb8e2fc157f552515cee4c785af6886840d420ec27e86f4e0";
const SUPERSEDED_ADVERTISED_CFW_2_2_8_8_SHA256 =
  "9a7ebf7b7989730ca30195af46219c188fff3c3023533b763d0ca5abf8243944";
const REVIEWED_CFW_2_2_8_11_SHA256 =
  "be3922f3695e0b58a6b62f40f760b6c8754488c4e9a58c96b2c13e92ef33bd3a";
const REVIEWED_CFW_2_2_7_16_SHA256 =
  "6c0fdfed0eabfc40ba718ec1eec6b0728e9794a8abdb6079ebdcee2c56f58127";
const REVIEWED_G2FLASH_CFW_2_2_6_11_SHA256 =
  "105032302d02ccf943b785070cf15877a918c120b7ca1332bb6261f70eb6d683";
const SUPERSEDED_ADVERTISED_CFW_2_2_8_9_SHA256 =
  "742a0241f7ba34c6fb45c9a3ec616ba0be2b92f9c3e656b9824f6bc21a5513ca";
const WITHDRAWN_CFW_2_2_8_10_SHA256 =
  "3f99dcaf4c39a352402331f843f5beb7c115120f3800a7dacc568f9fe2e63e62";
const OFFICIAL_G2_2_2_7_14_SHA256 =
  "0fced0aebcc6c88db6f76dba34f91b805d842a5fc297bfd7fa6d6a34ec83cecb";
const OFFICIAL_G2_2_2_8_4_SHA256 =
  "df7b8bd18727765eba73be5ab836e0ee4cfd17b5e680046003b8d608d2fbfda7";
const OFFICIAL_G2_2_3_0_24_SHA256 =
  "187ccf2bcc5c17a212106e8a376745511e8289c4232b634a7ea94b9bf25a0979";
const OFFICIAL_G2_2_2_10_10_SHA256 =
  "927879057685a4147c6ba1fe33e5f3740d3cc48f87141a9039204d94516e65b8";
const OFFICIAL_G2_2_2_9_22_SHA256 =
  "a03fbea9f68a9de6bc271daabb9f3a41c59053d1086622c76a4e990f829cc561";
const REVIEWED_CFW_2_2_9_24_SHA256 =
  "75eebde79ffe397d65980f8b03a60fefa8f8cb0c70b621ab355d6c2f90a8e445";
const REVIEWED_CFW_2_2_9_25_SHA256 =
  "62c138ab9f998f4dd1affb0ebd491ae7c563e424ce6f579b5484c9995730e215";
const REVIEWED_CFW_2_2_9_28_SHA256 =
  "dc4c4de98d183a98f8b2e98b91ab0c920b46a1ec30fcdf3d447637f2022df484";
const REVIEWED_CFW_2_2_10_72_SHA256 =
  "f3bd05f9adaae94cbf2a693b7259a98c11454ba270fe09311bdfd38484d1161c";
const REVIEWED_CFW_230_26_SHA256 =
  "8784efd8892a027dd2a0b7eee4dae1b1679cfa1b8008aa1b296103cfe674b0ba";
const EXPERIMENTAL_CFW_230_27_SHA256 =
  "36cc6222227275d0fd07f134c765737e508b5e205e6d6aa1122a4b2cf1996bfa";
const REVIEWED_CFW_230_84_SHA256 =
  "afa6c1da6bc1ba6b0904a438b6acb7f6e628b4fd53c82e1c58d71ba4a431f68b";
const REVIEWED_CFW_230_85_SHA256 =
  "32d7304ce85304ba9f6e1c8f65d2812913e556ef5506582b016ea78c3f37c860";
const REVIEWED_CFW_2_2_9_29_SHA256 =
  "960b964f2dfdfb17edf222f0ec3c5c44ca9ee502fe2a9873919e951a6c158ac5";

// The catalog production actually served on 2026-07-28 and is older than the
// current official releases pinned by this build.
const STALE_PRODUCTION_CATALOG = [
  { id: "g2-custom-2.2.6.10", version: "2.2.6.10-cfw", sha256: LEGACY_CFW_SHA256 },
  {
    id: "g2-official-2.2.6.10",
    version: "2.2.6.10",
    sha256: "f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa",
  },
];

test("parses versions that carry a channel suffix", () => {
  assert.deepEqual(parseFirmwareVersion("2.2.6.10-cfw"), [2, 2, 6, 10]);
  assert.deepEqual(parseFirmwareVersion("2.2.6.11"), [2, 2, 6, 11]);
  assert.equal(parseFirmwareVersion("cfw"), null);
  assert.equal(parseFirmwareVersion(null), null);
});

test("orders versions numerically, not lexically", () => {
  // The bug this guards: "2.2.6.9" sorts after "2.2.6.10" as a string.
  assert.equal(compareFirmwareVersions("2.2.6.11", "2.2.6.10"), 1);
  assert.equal(compareFirmwareVersions("2.2.6.10", "2.2.6.11"), -1);
  assert.equal(compareFirmwareVersions("2.2.6.10", "2.2.6.10-cfw"), 0);
  assert.equal(compareFirmwareVersions("2.2.6.10", "nonsense"), null);
});

test("flags a pinned image the served library is too old to offer", () => {
  const missing = findUnservedPinnedImages({
    catalog: STALE_PRODUCTION_CATALOG,
    targets: TEMPLE_FLASH_TARGETS,
  });
  assert.deepEqual(
    missing.map((target) => target.imageSha256),
    [
      REVIEWED_CFW_230_85_SHA256,
      OFFICIAL_G2_2_3_0_24_SHA256,
      OFFICIAL_G2_2_2_10_10_SHA256,
      OFFICIAL_G2_2_2_9_22_SHA256,
      OFFICIAL_G2_2_2_8_4_SHA256,
      OFFICIAL_G2_2_2_7_14_SHA256,
    ],
    "newer official releases are newer than anything the stale catalog serves",
  );
});

test("blocks firmware mutation when the served library is behind the build", () => {
  assert.throws(
    () =>
      assertFirmwareCatalogCoversPinnedImages({
        catalog: STALE_PRODUCTION_CATALOG,
        targets: TEMPLE_FLASH_TARGETS,
      }),
    (error) => {
      assert.equal(error instanceof FirmwareCatalogCoverageError, true);
      assert.deepEqual(
        error.missingPinnedImages.map((target) => target.imageSha256),
        [
          REVIEWED_CFW_230_85_SHA256,
          OFFICIAL_G2_2_3_0_24_SHA256,
              OFFICIAL_G2_2_2_10_10_SHA256,
          OFFICIAL_G2_2_2_9_22_SHA256,
          OFFICIAL_G2_2_2_8_4_SHA256,
          OFFICIAL_G2_2_2_7_14_SHA256,
        ],
      );
      assert.match(error.message, /No device mutation was started/);
      return true;
    },
  );
});

test("omits retired CFW releases from the catalog and writer allowlist", async () => {
  const catalog = JSON.parse(
    await readFile(
      new URL("../public/firmware-updates/source-files/index.json", import.meta.url),
      "utf8",
    ),
  ).releases;
  const cfwDigests = [
    REVIEWED_CFW_230_26_SHA256,
    REVIEWED_CFW_230_84_SHA256,
    EXPERIMENTAL_CFW_230_27_SHA256,
    REVIEWED_CFW_2_2_10_72_SHA256,
    REVIEWED_CFW_2_2_9_29_SHA256,
    REVIEWED_CFW_2_2_9_28_SHA256,
    REVIEWED_CFW_2_2_9_25_SHA256,
    REVIEWED_CFW_2_2_9_24_SHA256,
    REVIEWED_CFW_2_2_8_11_SHA256,
    REVIEWED_CFW_2_2_7_16_SHA256,
    REVIEWED_G2FLASH_CFW_2_2_6_11_SHA256,
  ];
  assert.deepEqual(
    catalog.filter((release) => release.channel === "custom").map((release) => release.id),
    ["g2-custom-2.3.0.24-230.85"],
  );
  for (const sha256 of cfwDigests) {
    assert.equal(catalog.some((release) => release.sha256 === sha256), false);
    assert.equal(TEMPLE_FLASH_TARGETS.some((target) => target.imageSha256 === sha256), false);
  }
  assert.deepEqual(findUnservedPinnedImages({ catalog, targets: TEMPLE_FLASH_TARGETS }), []);
});

test("excludes advertisement-patched CFW releases from both mutation paths", async () => {
  const catalog = JSON.parse(
    await readFile(
      new URL("../public/firmware-updates/source-files/index.json", import.meta.url),
      "utf8",
    ),
  ).releases;

  for (const digest of [
    SUPERSEDED_ADVERTISED_CFW_2_2_8_7_SHA256,
    SUPERSEDED_ADVERTISED_CFW_2_2_8_8_SHA256,
    SUPERSEDED_ADVERTISED_CFW_2_2_8_9_SHA256,
    WITHDRAWN_CFW_2_2_8_10_SHA256,
  ]) {
    assert.equal(
      catalog.some((release) => release.sha256 === digest),
      false,
      "an advertisement-patched package must not be offered",
    );
    assert.equal(
      TEMPLE_FLASH_TARGETS.some((target) => target.imageSha256 === digest),
      false,
      "an advertisement-patched package must not remain in a writer allowlist",
    );
  }
});

test("ships only revision 85 with honest hardware status and complete BLE components", async () => {
  const catalog = JSON.parse(await readFile(
    new URL("../public/firmware-updates/source-files/index.json", import.meta.url), "utf8"));
  const custom = catalog.releases.filter((release) => release.channel === "custom");
  assert.equal(custom.length, 1);
  const release = custom[0];
  assert.equal(release.id, "g2-custom-2.3.0.24-230.85");
  assert.equal(release.sha256, REVIEWED_CFW_230_85_SHA256);
  assert.equal(release.trust, "reviewed-custom");
  assert.equal(release.requiredCfwMarker, "SybilSight/230.85");
  assert.equal(release.hardwareValidated, false);
  assert.equal(release.caseRecoveryEligible, false);
  assert.equal(release.bleComponentNames, undefined);
  assert.equal(release.components.length, 6);
  assert.match(release.displayName, /hardware unvalidated/);
  assert.match(release.notes, /not yet been validated/);
  const manifest = JSON.parse(await readFile(new URL("../public" + release.manifestUrl, import.meta.url), "utf8"));
  assert.equal(manifest.capabilityMarker, release.requiredCfwMarker);
  assert.equal(manifest.package.sha256, release.sha256);
  assert.equal(manifest.patchRecipe.operationCount, 94);
  assert.equal(manifest.sourceProvenance.keyboard_contract, 1);
  assert.equal(manifest.sourceProvenance.keyboard_upstream_commit, "46165ab41e8de70fdd1f8abf523137249afafde2");
  assert.equal(manifest.release.hardwareValidated, false);
});

test("deployment validation pins the permitted custom firmware releases", async () => {
  const deployWorkflow = await readFile(
    new URL("../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  );
  assert.match(deployWorkflow, /g2-custom-2\.3\.0\.24-230\.85/);
  assert.match(deployWorkflow, new RegExp(REVIEWED_CFW_230_85_SHA256));
  for (const retired of [REVIEWED_CFW_230_26_SHA256, REVIEWED_CFW_230_84_SHA256,
    EXPERIMENTAL_CFW_230_27_SHA256, REVIEWED_CFW_2_2_10_72_SHA256]) {
    assert.equal(deployWorkflow.includes(retired), false);
  }
  assert.match(deployWorkflow, /unexpected CFW release/);
});

test("says nothing when it cannot tell", () => {
  assert.deepEqual(findUnservedPinnedImages({}), []);
  assert.deepEqual(
    findUnservedPinnedImages({ catalog: [], targets: TEMPLE_FLASH_TARGETS }),
    [],
  );
  assert.deepEqual(
    findUnservedPinnedImages({
      catalog: [{ version: "not-a-version", sha256: "aa" }],
      targets: TEMPLE_FLASH_TARGETS,
    }),
    [],
  );
});
