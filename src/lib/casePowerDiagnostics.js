import { parseConsoleReport } from "./firmware.js";

function stats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { min: sorted[0], max: sorted.at(-1), median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 };
}

function registerDump(text, prefix, count, startRegister, source) {
  const line = text.split(/\r?\n/).find((value) => value.startsWith(prefix));
  if (!line) return { source, available: false, reason: "No complete register dump received." };
  const tokens = line.slice(prefix.length).trim().split(/\s+/);
  if (tokens.length !== count || tokens.some((value) => !/^[\da-f]{1,2}$/i.test(value))) {
    return { source, available: false, reason: "Register dump was malformed or interrupted." };
  }
  const values = tokens.map((value) => Number.parseInt(value, 16));
  if (values.every((value) => value === 255)) {
    return { source, available: false, values, reason: "All-FF register data may be the stock reader's failure sentinel." };
  }
  return { source, available: true, startRegister, values, hex: values.map((value) => value.toString(16).padStart(2, "0")).join(" "), interpretation: "Raw registers; no voltage/current conversion is established." };
}

export function buildCasePowerDiagnostics({ bootText = "", registerReplies = {}, samples = [], context = "", capturedAt = new Date().toISOString() } = {}) {
  const text = [bootText, ...Object.values(registerReplies), ...samples.map((sample) => sample.text)].join("\n");
  const consoleReport = parseConsoleReport(text);
  const oneSideStatus = /One-side charging:\s*(enabled|disabled)/i.exec(registerReplies.DED3 ?? "");
  const oneSideChargingEnabled = oneSideStatus ? oneSideStatus[1].toLowerCase() === "enabled" : null;
  const readings = samples.flatMap((sample, index) => {
    const matches = [...sample.text.matchAll(/B200\s+vol:(-?\d+)\s+pct:(-?\d+),\s*open:(\d+),\s*usb:(\d+),\s*cur:(-?\d+),\s*GLS_L:(\d+),\s*GLS_R:(\d+)\s+temp:(-?\d+)(?:,\s*chEn:(\d+),\s*aging:(\d+),\s*otaGls:(\d+))?/g)];
    return matches.map((m) => ({ queryIndex: index, observedAt: sample.observedAt, caseBatteryVoltageMv: Number(m[1]), caseBatteryPercent: Number(m[2]), lidOpen: m[3] === "1", usbPresent: m[4] === "1", caseCurrentRaw: Number(m[5]), leftDetected: m[6] === "1", rightDetected: m[7] === "1", temperatureRaw: Number(m[8]), chargingEnabled: m[9] == null ? null : m[9] === "1" }));
  });
  return {
    schemaVersion: 1, capturedAt, context, caseSerial: consoleReport.serialNumber, caseVersion: consoleReport.caseVersion,
    commands: ["DEA0", "DEAA", "DEAB", "DED3", "DEA3"], firmwareBytesSent: 0,
    oneSideChargingEnabled,
    singleContactChargingReferenceBlocked: oneSideChargingEnabled === false && readings.some((r) => r.leftDetected !== r.rightDetected),
    readings, sampledQueryCount: samples.length, queryCountWithTelemetry: new Set(readings.map((r) => r.queryIndex)).size,
    summary: { caseBatteryVoltageMv: stats(readings.map((r) => r.caseBatteryVoltageMv)), caseCurrentRaw: stats(readings.map((r) => r.caseCurrentRaw)) },
    registers: {
      yhm2510Live: registerDump(registerReplies.DEAA ?? "", "0x00-0x07:", 8, 0, "DEAA live YHM2510 read"),
      yhm2510Cached: registerDump(registerReplies.DEAA ?? "", "2510: 0x00-0x07:", 8, 0, "DEAA cached initialization snapshot"),
      casePmic: registerDump(registerReplies.DEAB ?? "", "PMIC 0x10-0x1B:", 12, 16, "DEAB Case PMIC read"),
    },
    templeStatusRelayedByCase: consoleReport.templeCharging,
    independentRightChannel: { voltageMv: null, currentMa: null, powerMw: null, reason: "No verified independent right-pogo voltage/current decode or calibrated conversion is available." },
    measurementBoundary: "Case battery voltage is not voltage delivered at the pogo contacts. Case current is an aggregate raw value, not calibrated per-temple charging current. Relayed temple voltage/current requires a temple reply. Presence and these samples do not prove a completed charging circuit.",
    rawConsole: text,
  };
}

export function compareCasePowerDiagnostics(sample, reference) {
  if (!sample?.caseSerial || sample.caseSerial !== reference?.caseSerial) return { comparable: false, reason: "Use a reference captured from the same Case." };
  if (!sample.readings?.length || !reference.readings?.length) return { comparable: false, reason: "Both captures need telemetry." };
  if (sample.singleContactChargingReferenceBlocked || reference.singleContactChargingReferenceBlocked) return { comparable: false, reason: "One-side charging is disabled: an isolated-contact capture is not a normal charging reference." };
  const conditions = (capture) => new Set(capture.readings.map((r) => `${r.lidOpen}/${r.usbPresent}/${r.leftDetected}/${r.rightDetected}`));
  const a = conditions(sample), b = conditions(reference);
  if (a.size !== 1 || b.size !== 1 || [...a][0] !== [...b][0]) return { comparable: false, reason: "Lid, USB, or detected-contact conditions differ or changed during capture." };
  return { comparable: true, caseBatteryVoltageMedianDeltaMv: sample.summary.caseBatteryVoltageMv.median - reference.summary.caseBatteryVoltageMv.median, caseCurrentMedianDeltaRaw: sample.summary.caseCurrentRaw.median - reference.summary.caseCurrentRaw.median, boundary: "Observed reference comparison only; not a normal charging threshold or a continuity test." };
}
