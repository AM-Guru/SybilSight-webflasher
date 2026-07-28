import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compareFirmwareVersions,
  findUnservedPinnedImages,
  parseFirmwareVersion,
} from "../src/lib/catalogCoverage.js";
import { TEMPLE_FLASH_TARGETS } from "../src/lib/templeFlashTargets.js";

const LEGACY_CFW_SHA256 =
  "5c1539fd39c599e6035f6a8ec0779ba687c250d342a24c21a39952fed6c56aa0";
const REVIEWED_CFW_2_2_6_11_SHA256 =
  "d2fb5dcef485b1bb14818b8dc56811b9d278d6fc2b81e56c496c53b72aaa1e86";

// The catalog production actually served on 2026-07-28: newest CFW is the
// legacy 2.2.6.10 build, and reviewed CFW 2.2.6.11 is absent entirely.
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
    [REVIEWED_CFW_2_2_6_11_SHA256],
    "reviewed CFW 2.2.6.11 is newer than anything the stale catalog serves",
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
  assert.ok(
    catalog.some((release) => release.sha256 === REVIEWED_CFW_2_2_6_11_SHA256),
    "the shipped catalog should serve reviewed CFW 2.2.6.11",
  );
  assert.ok(
    !catalog.some((release) => release.sha256 === LEGACY_CFW_SHA256),
    "the shipped catalog should no longer serve the legacy CFW",
  );
  assert.deepEqual(
    findUnservedPinnedImages({ catalog, targets: TEMPLE_FLASH_TARGETS }),
    [],
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
