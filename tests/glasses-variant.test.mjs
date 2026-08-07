import assert from "node:assert/strict";
import test from "node:test";

import {
  compareTempleSerials,
  decodeGlassesSerial,
  describeGlassesSerial,
  normalizeGlassesSerial,
  sameGlassesVariant,
  templeSerialMismatchWarning,
} from "../src/lib/glassesVariant.js";
import {
  EVEN_COMPANY_IDENTIFIER,
  decodeDeviceInformationString,
  evaluateG2PairIdentity,
  glassesSerialChooserFilter,
  requestG2BleDevice,
} from "../src/lib/g2BleOta.js";
import { buildDeviceFingerprint } from "../src/lib/deviceIdentity.js";

// Serials observed on real hardware. S211GBBC180304 is a G2 Frame B in brown.
const G2_B_BROWN = "S211GBBC180304";
const G2_B_GREEN = "S211GCBC300403";

test("decodes an observed G2 serial into family, frame and colourway", () => {
  const decoded = decodeGlassesSerial(G2_B_BROWN);
  assert.equal(decoded.family, "g2");
  assert.equal(decoded.frame, "b");
  assert.equal(decoded.frameShape, "square");
  assert.equal(decoded.colorway, "brown");
  assert.equal(decoded.modelCode, "S211");
  assert.equal(decoded.productName, "Even G2 B");
  assert.equal(decoded.displayName, "Even G2 B · Brown");
  assert.equal(decoded.variantSummary, "Frame B (square) · Brown");
});

test("takes the colourway from the sixth character", () => {
  assert.equal(decodeGlassesSerial("S211GAAA000001").colorway, "grey");
  assert.equal(decodeGlassesSerial(G2_B_BROWN).colorway, "brown");
  assert.equal(decodeGlassesSerial(G2_B_GREEN).colorway, "green");
});

test("maps every known frame prefix, and Frame A is the round one", () => {
  assert.equal(decodeGlassesSerial("S201GAAA000001").frame, "a");
  assert.equal(decodeGlassesSerial("S281GAAA000001").frame, "a");
  assert.equal(decodeGlassesSerial("S211GAAA000001").frame, "b");
  assert.equal(decodeGlassesSerial("S291GAAA000001").frame, "b");
  assert.equal(decodeGlassesSerial("S221GAAA000001").frame, "c");
  assert.equal(decodeGlassesSerial("S201GAAA000001").frameShape, "round");
  assert.equal(decodeGlassesSerial("S211GAAA000001").frameShape, "square");
});

// The vendor app defaults an unknown prefix to Frame A. A flashing tool must
// not tell an operator they are holding a shape the serial never claimed.
test("an unrecognised model code keeps the family but claims no shape", () => {
  const decoded = decodeGlassesSerial("S231GBAA000001");
  assert.equal(decoded.family, "g2");
  assert.equal(decoded.frame, null);
  assert.equal(decoded.colorway, "brown");
  assert.equal(decoded.productName, "Even G2");
  assert.equal(decoded.variantSummary, "Brown");
});

test("an unrecognised colour byte claims no finish", () => {
  const decoded = decodeGlassesSerial("S211GZAA000001");
  assert.equal(decoded.frame, "b");
  assert.equal(decoded.colorway, null);
  assert.equal(decoded.displayName, "Even G2 B");
});

test("decodes G1 and the R1 ring families", () => {
  assert.equal(decodeGlassesSerial("S110GAAA000001").family, "g1");
  assert.equal(decodeGlassesSerial("S110GAAA000001").frame, "b");
  assert.equal(decodeGlassesSerial("S100GAAA000001").frame, "a");
  const ring = decodeGlassesSerial("B210GAAA000001");
  assert.equal(ring.family, "r1");
  assert.equal(ring.frame, null);
  assert.equal(ring.colorway, null);
  assert.equal(ring.displayName, "Even R1");
});

test("normalises the arm suffix and casing away", () => {
  assert.equal(normalizeGlassesSerial(`${G2_B_BROWN}_L_1`), G2_B_BROWN);
  assert.equal(
    decodeGlassesSerial(` ${G2_B_BROWN.toLowerCase()} `).serial,
    G2_B_BROWN,
  );
});

test("rejects values that are not Even serials", () => {
  assert.equal(decodeGlassesSerial("EVEN_G2_ALPHA"), null);
  assert.equal(decodeGlassesSerial("S211G"), null);
  assert.equal(decodeGlassesSerial(""), null);
  assert.equal(decodeGlassesSerial(null), null);
  assert.equal(describeGlassesSerial(null), null);
  assert.match(describeGlassesSerial("ZZ9999999"), /unrecognised serial format/);
});

test("compares temple serials across the arm suffix", () => {
  assert.equal(
    compareTempleSerials(`${G2_B_BROWN}_L_1`, G2_B_BROWN.toLowerCase()).verdict,
    "matched",
  );
  assert.equal(compareTempleSerials(G2_B_BROWN, G2_B_GREEN).verdict, "mismatched");
  assert.equal(compareTempleSerials(G2_B_BROWN, null).verdict, "unknown");
  assert.equal(compareTempleSerials("  ", G2_B_BROWN).verdict, "unknown");
});

test("the mismatch warning names both serials and the visible difference", () => {
  assert.equal(templeSerialMismatchWarning({ verdict: "matched" }), null);
  const warning = templeSerialMismatchWarning(
    compareTempleSerials(G2_B_BROWN, "S201GCBC300403"),
  );
  assert.match(warning, /S211GBBC180304/);
  assert.match(warning, /S201GCBC300403/);
  assert.match(warning, /Even G2 B · Brown/);
  assert.match(warning, /Even G2 A · Green/);
});

test("same-variant is about the SKU, never about the pair", () => {
  // Two different pairs of the identical SKU: same variant, still not a pair.
  assert.equal(sameGlassesVariant(G2_B_BROWN, "S211GBBC999999"), true);
  assert.equal(
    compareTempleSerials(G2_B_BROWN, "S211GBBC999999").verdict,
    "mismatched",
  );
  assert.equal(sameGlassesVariant(G2_B_BROWN, G2_B_GREEN), false);
  assert.equal(sameGlassesVariant(G2_B_BROWN, "nonsense"), null);
});

// MARK: Device Information reads

test("decodes NUL-padded Device Information strings", () => {
  const padded = new Uint8Array(16);
  padded.set(new TextEncoder().encode(G2_B_BROWN));
  const view = new DataView(padded.buffer);
  assert.equal(decodeDeviceInformationString(view), G2_B_BROWN);
  assert.equal(
    decodeDeviceInformationString(new TextEncoder().encode(` ${G2_B_BROWN} `)),
    G2_B_BROWN,
  );
  assert.equal(decodeDeviceInformationString(new Uint8Array(8)), null);
  assert.equal(decodeDeviceInformationString(null), null);
});

// MARK: Chooser filtering
//
// The advertisement below is a real HCI capture of the S211GBBC180304 pair:
//
//   18 ff 45 52 53 32 31 31 47 42 42 43 31 38 30 33 30 34 e0 ec b6 14 12 e0 02
//   \_/ \_/ \___/ \_______________________________________/ \______________/ \/
//   len type comp  SN(14) ASCII                              MAC(6, LE)     flag
//
// The filter has to reproduce the company identifier and the serial bytes
// exactly, so it is asserted against those captured bytes rather than against
// a value derived the same way the implementation derives it.
const CAPTURED_ADVERTISEMENT = Uint8Array.from([
  0x18, 0xff, 0x45, 0x52, 0x53, 0x32, 0x31, 0x31, 0x47, 0x42, 0x42, 0x43,
  0x31, 0x38, 0x30, 0x33, 0x30, 0x34, 0xe0, 0xec, 0xb6, 0x14, 0x12, 0xe0,
  0x02,
]);

test("the company identifier is the little-endian pair from the capture", () => {
  const [low, high] = CAPTURED_ADVERTISEMENT.subarray(2, 4);
  assert.equal(EVEN_COMPANY_IDENTIFIER, low | (high << 8));
  // Those same bytes spell "ER" in order, which is why the SybilSight decoder
  // reads them as a literal prefix. They are the company field all the same.
  assert.equal(String.fromCharCode(low, high), "ER");
});

test("the serial filter matches the captured advertisement bytes", () => {
  const filter = glassesSerialChooserFilter(G2_B_BROWN);
  assert.equal(filter.manufacturerData[0].companyIdentifier, 0x5245);
  assert.deepEqual(
    [...filter.manufacturerData[0].dataPrefix],
    // Everything after the company identifier, up to the end of the serial.
    [...CAPTURED_ADVERTISEMENT.subarray(4, 18)],
  );
});

test("a partial serial is a legal prefix, junk is not a filter at all", () => {
  const partial = glassesSerialChooserFilter("S211GB");
  assert.deepEqual(
    [...partial.manufacturerData[0].dataPrefix],
    [...new TextEncoder().encode("S211GB")],
  );
  assert.equal(glassesSerialChooserFilter("S211"), null);
  assert.equal(glassesSerialChooserFilter(""), null);
  assert.equal(glassesSerialChooserFilter(null), null);
});

test("a known serial narrows the chooser to that pair alone", async () => {
  let options = null;
  const device = { name: "Even G2_32_L_4FB39E", id: "left", gatt: {} };
  await requestG2BleDevice(
    "left",
    {
      requestDevice: async (value) => {
        options = value;
        return device;
      },
    },
    { expectedSerial: G2_B_BROWN },
  );
  // The name prefixes must NOT remain alongside it: filters are OR-ed, so
  // keeping them would re-admit every other G2 in the room.
  assert.equal(options.filters.length, 1);
  assert.equal(
    options.filters[0].manufacturerData[0].companyIdentifier,
    EVEN_COMPANY_IDENTIFIER,
  );
  assert.equal(options.filters[0].namePrefix, undefined);
});

test("without a serial the chooser keeps the original name filters", async () => {
  let options = null;
  const device = { name: "Even G2_32_L_4FB39E", id: "left", gatt: {} };
  for (const expectedSerial of [null, "", "not-a-serial"]) {
    await requestG2BleDevice(
      "left",
      {
        requestDevice: async (value) => {
          options = value;
          return device;
        },
      },
      { expectedSerial },
    );
    assert.deepEqual(
      options.filters.map((filter) => filter.namePrefix),
      ["Even G2", "G2_"],
      `expectedSerial ${JSON.stringify(expectedSerial)} must not narrow the chooser`,
    );
  }
});

// MARK: Pair gate

test("two temples reporting one serial are a matched pair", () => {
  const verdict = evaluateG2PairIdentity(
    { serialNumber: G2_B_BROWN },
    { serialNumber: `${G2_B_BROWN}_R_1` },
  );
  assert.equal(verdict.status, "matched");
  assert.equal(verdict.blocking, false);
  assert.equal(verdict.serial, G2_B_BROWN);
  assert.match(verdict.message, /Even G2 B · Brown/);
  assert.match(verdict.message, /one matched pair/);
});

test("two temples from different pairs block, and the message says why", () => {
  const verdict = evaluateG2PairIdentity(
    { serialNumber: G2_B_BROWN },
    { serialNumber: G2_B_GREEN },
  );
  assert.equal(verdict.status, "mismatched");
  assert.equal(verdict.blocking, true);
  assert.match(verdict.message, /different serial numbers/);
  assert.match(verdict.message, /matched set before flashing/);
});

// Firmware states this tool exists to repair frequently cannot answer a
// Device Information read. Absence of evidence must never stop the work.
test("a temple that reports no serial is unverified, not blocked", () => {
  const verdict = evaluateG2PairIdentity(
    { serialNumber: G2_B_BROWN },
    { serialNumber: null },
  );
  assert.equal(verdict.status, "unverified");
  assert.equal(verdict.blocking, false);
  assert.match(verdict.message, /right temple/);

  const neither = evaluateG2PairIdentity(null, null);
  assert.equal(neither.status, "unverified");
  assert.equal(neither.blocking, false);
});

// MARK: Fingerprint

test("the fingerprint records the decoded variant when the temples were read", () => {
  const fingerprint = buildDeviceFingerprint({
    report: { console: { serialNumber: "00310025514250052037384b" } },
    templeIdentities: {
      left: { serialNumber: G2_B_BROWN },
      right: { serialNumber: G2_B_BROWN },
    },
  });
  assert.equal(fingerprint.frameVariant.value, "B");
  assert.equal(fingerprint.frameVariant.shape, "square");
  assert.equal(fingerprint.frameVariant.colorway, "brown");
  assert.equal(
    fingerprint.frameVariant.source,
    "temple-device-information-serial",
  );
  assert.equal(fingerprint.frameVariant.reason, null);
  assert.equal(fingerprint.glasses.pairVerdict, "matched");
  assert.equal(fingerprint.glasses.serial, G2_B_BROWN);
  assert.equal(fingerprint.glasses.displayName, "Even G2 B · Brown");
});

test("the USB-only fingerprint keeps the honest unknown-variant reason", () => {
  const fingerprint = buildDeviceFingerprint({
    report: { console: { serialNumber: "00310025514250052037384b" } },
  });
  assert.equal(fingerprint.glasses, null);
  assert.equal(fingerprint.frameVariant.value, null);
  assert.match(fingerprint.frameVariant.reason, /operator label/);
  // The Case UID is not a product serial and must never be decoded as one.
  assert.equal(decodeGlassesSerial("00310025514250052037384b"), null);
});

test("a mismatched pair is recorded in the fingerprint, not silently averaged", () => {
  const fingerprint = buildDeviceFingerprint({
    report: { console: { serialNumber: "00310025514250052037384b" } },
    templeIdentities: {
      left: { serialNumber: G2_B_BROWN },
      right: { serialNumber: G2_B_GREEN },
    },
  });
  assert.equal(fingerprint.glasses.pairVerdict, "mismatched");
  assert.equal(fingerprint.glasses.serial, null);
  assert.equal(fingerprint.glasses.leftSerial, G2_B_BROWN);
  assert.equal(fingerprint.glasses.rightSerial, G2_B_GREEN);
});
