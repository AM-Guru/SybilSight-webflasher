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
const SUPERSEDED_ADVERTISED_CFW_2_2_8_9_SHA256 =
  "742a0241f7ba34c6fb45c9a3ec616ba0be2b92f9c3e656b9824f6bc21a5513ca";
const WITHDRAWN_CFW_2_2_8_10_SHA256 =
  "3f99dcaf4c39a352402331f843f5beb7c115120f3800a7dacc568f9fe2e63e62";
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
      REVIEWED_CFW_2_2_8_11_SHA256,
      OFFICIAL_G2_2_2_8_4_SHA256,
      OFFICIAL_G2_2_2_7_14_SHA256,
    ],
    "the latest CFW and newer official releases are newer than anything the stale catalog serves",
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
          REVIEWED_CFW_2_2_8_11_SHA256,
          OFFICIAL_G2_2_2_8_4_SHA256,
          OFFICIAL_G2_2_2_7_14_SHA256,
        ],
      );
      assert.match(error.message, /No device mutation was started/);
      return true;
    },
  );
});

test("offers only the latest CFW while retaining official firmware", async () => {
  const catalog = JSON.parse(
    await readFile(
      new URL("../public/firmware-updates/source-files/index.json", import.meta.url),
      "utf8",
    ),
  ).releases;
  const reviewed228 = catalog.find(
    (release) => release.sha256 === REVIEWED_CFW_2_2_8_11_SHA256,
  );
  assert.ok(
    reviewed228,
    "the shipped catalog should serve CFW 2.2.8.11",
  );
  assert.equal(reviewed228.hardwareValidated, false);
  assert.deepEqual(
    catalog.filter((release) => release.channel === "custom").map((release) => release.version),
    ["2.2.8.11"],
    "no superseded CFW release may remain in the WebFlasher listing",
  );
  assert.ok(catalog.some((release) => release.sha256 === OFFICIAL_G2_2_2_8_4_SHA256));
  assert.ok(catalog.some((release) => release.sha256 === OFFICIAL_G2_2_2_7_14_SHA256));
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

test("keeps custom firmware release copy plain-language and repository-free", async () => {
  const catalog = JSON.parse(
    await readFile(
      new URL("../public/firmware-updates/source-files/index.json", import.meta.url),
      "utf8",
    ),
  ).releases;
  const customReleases = catalog.filter((release) => release.channel === "custom");
  const forbiddenUserFacingTerms =
    /g2flash|jimrandomh|framebuffer|zlib|\brle\b|\blz4\b|\b8bpp\b|capability field|wake lease/i;

  assert.ok(customReleases.length > 0);
  for (const release of customReleases) {
    assert.equal(release.notes, null);
    assert.ok(release.capabilities.length > 0);
    assert.doesNotMatch(release.capabilities.join("\n"), forbiddenUserFacingTerms);
  }
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
