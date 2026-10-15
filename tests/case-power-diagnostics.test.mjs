import assert from "node:assert/strict";
import test from "node:test";
import { buildCasePowerDiagnostics, compareCasePowerDiagnostics } from "../src/lib/casePowerDiagnostics.js";
import { G2CaseSession } from "../src/lib/serial.js";

const boot = "****** B200 1.2.57 002300405845501620373941******";
const line = (v, c, right = 1) => `****** B200 vol:${v} pct:100, open:1, usb:1, cur:${c}, GLS_L:1, GLS_R:${right} temp:295, chEn:1, aging:0, otaGls:0`;
const capture = (v = 4170, c = -9) => buildCasePowerDiagnostics({ bootText: boot, registerReplies: { DEAA: "0x00-0x07:81 11 4 af af 3 81 20\n2510: 0x00-0x07:81 00 04 af af 03 81 20", DEAB: "PMIC 0x10-0x1B:d8 4c 0 90 14 8 0 28 1 2 0 1" }, samples: [{ text: line(v, c), observedAt: "now" }, { text: line(v + 2, c - 2), observedAt: "later" }] });

test("separates live and cached registers, battery voltage, and unverified independent channels", () => {
  const result = capture();
  assert.equal(result.registers.yhm2510Live.hex, "81 11 04 af af 03 81 20");
  assert.equal(result.registers.yhm2510Cached.hex, "81 00 04 af af 03 81 20");
  assert.equal(result.registers.casePmic.values.length, 12);
  assert.deepEqual(result.summary.caseBatteryVoltageMv, { min: 4170, max: 4172, median: 4171 });
  assert.equal(result.summary.caseCurrentRaw.median, -10);
  assert.equal(result.queryCountWithTelemetry, 2);
  assert.equal(result.independentRightChannel.currentMa, null);
  assert.equal(result.independentRightChannel.voltageMv, null);
});

test("rejects sentinel and interrupted dumps without filling missing telemetry", () => {
  const result = buildCasePowerDiagnostics({ registerReplies: { DEAA: "0x00-0x07:ff ff ff ff ff ff ff ff", DEAB: "PMIC 0x10-0x1B:d8 4c 00" }, samples: [{ text: "receive header timeout" }] });
  assert.equal(result.registers.yhm2510Live.available, false);
  assert.equal(result.registers.casePmic.available, false);
  assert.equal(result.summary.caseBatteryVoltageMv, null);
  assert.equal(result.queryCountWithTelemetry, 0);
});

test("compares only same-Case, stable matching capture conditions", () => {
  const a = capture(4170), b = capture(4160);
  assert.equal(compareCasePowerDiagnostics(a, b).caseBatteryVoltageMedianDeltaMv, 10);
  assert.equal(compareCasePowerDiagnostics(a, { ...b, caseSerial: "another" }).comparable, false);
  b.readings[0].rightDetected = false;
  assert.equal(compareCasePowerDiagnostics(a, b).comparable, false);
});

test("bounded sampling sends only identity, register reads, and telemetry, and closes port", async () => {
  const commands = []; let closed = false; let active = "boot";
  const session = new G2CaseSession(null, { openNormal: async () => ({
    clear() {}, write: async (bytes) => { active = new TextDecoder().decode(bytes).trim(); commands.push(active); },
    collectFor: async () => new TextEncoder().encode(active === "boot" ? boot : active === "DEA0" ? "B200 1.2.57, 5" : active === "DEAA" ? "0x00-0x07:81 11 4 af af 3 81 20" : active === "DEAB" ? "PMIC 0x10-0x1B:d8 4c 0 90 14 8 0 28 1 2 0 1" : line(4170, -9)),
    close: async () => { closed = true; },
  }) });
  const result = await session.sampleCasePower({ sampleCount: 2, intervalMs: 500, expectedSerial: "002300405845501620373941" });
  assert.deepEqual(commands, ["DEA0", "DEAA", "DEAB", "DED3", "DEA3", "DEA3"]);
  assert.equal(closed, true);
  assert.equal(result.firmwareBytesSent, 0);
  assert.equal(result.queryCountWithTelemetry, 2);
  await assert.rejects(() => session.sampleCasePower({ sampleCount: 100 }), /2–30/);
});

test("disabled one-side charging excludes isolated contacts as a charging reference", () => {
  const sample = buildCasePowerDiagnostics({ bootText: boot, registerReplies: { DED3: "One-side charging: disabled\r\n" }, samples: [{ text: line(4170, -9).replace("GLS_L:1", "GLS_L:0") }] });
  assert.equal(sample.oneSideChargingEnabled, false);
  assert.equal(sample.singleContactChargingReferenceBlocked, true);
  assert.equal(compareCasePowerDiagnostics(sample, sample).comparable, false);
  const both = buildCasePowerDiagnostics({ bootText: boot, registerReplies: { DED3: "One-side charging: disabled" }, samples: [{ text: line(4170, -9) }] });
  assert.equal(both.singleContactChargingReferenceBlocked, false);
  assert.equal(compareCasePowerDiagnostics(both, both).comparable, true);
  assert.equal(capture().oneSideChargingEnabled, null);
});

test("mismatched Case identity stops before register access and closes port", async () => {
  const commands = []; let closed = false;
  const session = new G2CaseSession(null, { openNormal: async () => ({ clear() {}, write: async (bytes) => commands.push(new TextDecoder().decode(bytes).trim()), collectFor: async () => new TextEncoder().encode(boot), close: async () => { closed = true; } }) });
  await assert.rejects(() => session.sampleCasePower({ expectedSerial: "other" }), /matching Case identity/);
  assert.deepEqual(commands, ["DEA0"]);
  assert.equal(closed, true);
});
