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
const REVIEWED_CFW_2_2_6_11_SHA256 =
  "d2fb5dcef485b1bb14818b8dc56811b9d278d6fc2b81e56c496c53b72aaa1e86";
const REVIEWED_CFW_2_2_6_12_SHA256 =
  "b4de0cd3ffce5b0c756a7625b5250378d7680637e82849b15291a56a279fb4cd";
const REVIEWED_CFW_2_2_7_16_SHA256 =
  "6c0fdfed0eabfc40ba718ec1eec6b0728e9794a8abdb6079ebdcee2c56f58127";
const REVIEWED_CFW_2_2_8_6_SHA256 =
  "95d110fc9d1279bc58268af89e62df92dc81060a8c5d08a17e458ea846edc209";
const OFFICIAL_G2_2_2_7_14_SHA256 =
  "0fced0aebcc6c88db6f76dba34f91b805d842a5fc297bfd7fa6d6a34ec83cecb";
const OFFICIAL_G2_2_2_8_4_SHA256 =
  "df7b8bd18727765eba73be5ab836e0ee4cfd17b5e680046003b8d608d2fbfda7";

// The catalog production actually served on 2026-07-28: newest CFW is the
// legacy 2.2.6.10 build; both current reviewed CFW releases are absent.
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
      REVIEWED_CFW_2_2_8_6_SHA256,
      OFFICIAL_G2_2_2_8_4_SHA256,
      REVIEWED_CFW_2_2_7_16_SHA256,
      OFFICIAL_G2_2_2_7_14_SHA256,
      REVIEWED_CFW_2_2_6_12_SHA256,
      REVIEWED_CFW_2_2_6_11_SHA256,
    ],
    "the new official and reviewed CFW releases are newer than anything the stale catalog serves",
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
          REVIEWED_CFW_2_2_8_6_SHA256,
          OFFICIAL_G2_2_2_8_4_SHA256,
          REVIEWED_CFW_2_2_7_16_SHA256,
          OFFICIAL_G2_2_2_7_14_SHA256,
          REVIEWED_CFW_2_2_6_12_SHA256,
          REVIEWED_CFW_2_2_6_11_SHA256,
        ],
      );
      assert.match(error.message, /No device mutation was started/);
      return true;
    },
  );
});

test("stays silent about images retired from the library for being old", async () => {
  // The shipped catalog no longer lists the legacy 2.2.6.10 CFW, which remains
  // pinned in the allowlist. That is deliberate retirement, not drift — warning
  // about it on every load would train operators to ignore the warning.
  const catalog = JSON.parse(
    await readFile(
      new URL("../public/firmware-updates/source-files/index.json", import.meta.url),
      "utf8",
    ),
  ).releases;
  const reviewed228 = catalog.find(
    (release) => release.sha256 === REVIEWED_CFW_2_2_8_6_SHA256,
  );
  assert.ok(
    reviewed228,
    "the shipped catalog should serve reviewed CFW 2.2.8.6",
  );
  assert.equal(reviewed228.hardwareValidated, false);
  const reviewed227 = catalog.find(
    (release) => release.sha256 === REVIEWED_CFW_2_2_7_16_SHA256,
  );
  assert.ok(
    reviewed227,
    "the shipped catalog should serve reviewed CFW 2.2.7.16",
  );
  assert.equal(reviewed227.hardwareValidated, false);
  assert.ok(
    catalog.some((release) => release.sha256 === REVIEWED_CFW_2_2_6_11_SHA256),
    "the shipped catalog should serve reviewed CFW 2.2.6.11",
  );
  assert.ok(
    catalog.some((release) => release.sha256 === REVIEWED_CFW_2_2_6_12_SHA256),
    "the shipped catalog should serve reviewed CFW 2.2.6.12",
  );
  assert.ok(
    !catalog.some((release) => release.sha256 === LEGACY_CFW_SHA256),
    "the shipped catalog should no longer serve the legacy CFW",
  );
  assert.deepEqual(
    findUnservedPinnedImages({ catalog, targets: TEMPLE_FLASH_TARGETS }),
    [],
  );
  assert.deepEqual(
    assertFirmwareCatalogCoversPinnedImages({
      catalog,
      targets: TEMPLE_FLASH_TARGETS,
    }),
    { verified: true, missingPinnedImages: [] },
  );
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
