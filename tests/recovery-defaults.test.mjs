import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TEMPLE_FLASH_MODE,
  DEFAULT_TEMPLE_FLASH_ROUTE,
  findLatestOfficialStockRelease,
} from "../src/lib/recoveryDefaults.js";

test("defaults recovery to a complete bilateral temple restore", () => {
  assert.equal(DEFAULT_TEMPLE_FLASH_ROUTE, "both");
  assert.equal(DEFAULT_TEMPLE_FLASH_MODE, "complete");
});

test("selects the newest official Stock release independent of catalog order", () => {
  const releases = [
    {
      id: "cfw",
      channel: "custom",
      version: "2.2.6.11",
      caseRecoveryEligible: false,
    },
    {
      id: "stock-old",
      channel: "official",
      version: "2.2.4.34",
      caseRecoveryEligible: true,
    },
    {
      id: "stock-new",
      channel: "official",
      version: "2.2.6.10",
      caseRecoveryEligible: true,
    },
  ];
  assert.equal(findLatestOfficialStockRelease(releases)?.id, "stock-new");
});
