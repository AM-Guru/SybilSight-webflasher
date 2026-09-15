#!/usr/bin/env node
// Query Even Realities' firmware check for the newest G2 and R1 packages, download them from
// the CDN, verify size and MD5 against the vendor metadata, and print the release entries to
// paste into scripts/build-firmware-archive.mjs (plus the SHA-256 pins the archive verifies).
//
// The check endpoints (`/v2/g/check_latest_firmware`, `/v2/g/check_firmware`) answer
// `{"code":403,"msg":"Your device went wrong"}` without an authenticated app session, so the
// request headers of a logged-in Even app session must be supplied (each `--header` is passed
// through verbatim), or a previously captured response can be replayed with `--response`.
//
//   node scripts/even-firmware-check.mjs --header 'Authorization: Bearer …' [--header …]
//   node scripts/even-firmware-check.mjs --response docs/firmware/2.3.0-vendor-check.json
//   options: --base https://api2.evenreal.co  --endpoint check_latest_firmware|check_firmware
//            --out docs/firmware/<name>-vendor-check.json  --no-download
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { unzipSync } from "fflate";

const CDN_BASE = "https://cdn.evenreal.co";

function argumentValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && index + 1 < process.argv.length) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}
const argument = (name, fallback) => argumentValues(name)[0] ?? fallback;

const base = argument("--base", "https://api2.evenreal.co");
const endpoint = argument("--endpoint", "check_latest_firmware");
const replay = argument("--response", null);
const outputPath = argument("--out", null);
const download = !process.argv.includes("--no-download");
const headers = Object.fromEntries(
  argumentValues("--header").map((line) => {
    const colon = line.indexOf(":");
    if (colon <= 0) throw new Error(`--header expects 'Name: value', got ${line}`);
    return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  }),
);

function digest(algorithm, bytes) {
  return createHash(algorithm).update(bytes).digest("hex");
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "SybilSight-Firmware-Archive/1.0" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function check(isRing) {
  const url = `${base}/v2/g/${endpoint}?is_ring=${isRing}`;
  const response = await fetch(url, { headers: { accept: "application/json", ...headers } });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
  if (body?.code !== 0 || !body?.data) {
    throw new Error(
      `${url} answered code ${body?.code} "${body?.msg}" — an authenticated Even app session's headers are required (see the header of this script)`,
    );
  }
  return { endpoint, query: `is_ring=${isRing}`, response: body };
}

function describe(check) {
  const data = check.response.data;
  const md5 = data.fileSign;
  const suffix = data.subPath?.split(".").pop() ?? (data.model === "R1" ? "zip" : "bin");
  return {
    model: data.model,
    version: data.version,
    md5,
    size: data.fileSize,
    minAppVersion: data.minAppVer,
    notes: (data.message ?? "").replace(/\s+/g, " ").trim(),
    url: `${CDN_BASE}${data.subPath ?? `/firmware/${md5}.${suffix}`}`,
    suffix,
  };
}

async function main() {
  let checks;
  if (replay) {
    checks = JSON.parse(await readFile(replay, "utf8")).checks;
  } else {
    checks = [await check(false), await check(true)];
    const record = {
      checkedAt: new Date().toISOString().slice(0, 10),
      source: base,
      checks,
    };
    const target = outputPath ?? `docs/firmware/${checks[0].response.data.version}-vendor-check.json`;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`Recorded vendor metadata in ${target}`);
  }
  for (const item of checks) {
    const release = describe(item);
    console.log(`\n${release.model} ${release.version} — ${release.url} (${release.size} bytes, md5 ${release.md5})`);
    if (!download) continue;
    const bytes = await fetchBytes(release.url);
    if (bytes.length !== release.size) throw new Error(`${release.model} ${release.version}: size ${bytes.length} != vendor ${release.size}`);
    if (digest("md5", bytes) !== release.md5) throw new Error(`${release.model} ${release.version}: MD5 mismatch`);
    const sha256 = digest("sha256", bytes);
    const directory = release.model === "R1"
      ? `public/firmware-updates/source-files/r1/${release.version}`
      : `firmware-archive/incoming/${release.version}`;
    await mkdir(directory, { recursive: true });
    const fileName = release.model === "R1" ? `r1-${release.version}-${release.md5}.zip` : `${release.md5}.bin`;
    await writeFile(path.join(directory, fileName), bytes);
    console.log(`  saved ${directory}/${fileName}; sha256 ${sha256}`);
    if (release.model === "R1") {
      const files = unzipSync(new Uint8Array(bytes));
      const bin = Buffer.from(files["application.bin"]);
      const dat = Buffer.from(files["application.dat"]);
      console.log(`  R1_RELEASES entry:\n  r1Release({\n    version: ${JSON.stringify(release.version)},\n    minAppVersion: ${JSON.stringify(release.minAppVersion)},\n    notes: ${JSON.stringify(release.notes)},\n    size: ${release.size},\n    md5: ${JSON.stringify(release.md5)},\n    sha256: ${JSON.stringify(sha256)},\n    binSize: ${bin.length},\n    binSha256: ${JSON.stringify(digest("sha256", bin))},\n    datSha256: ${JSON.stringify(digest("sha256", dat))},\n  }),`);
    } else {
      console.log(`  RELEASES entry:\n  {\n    version: ${JSON.stringify(release.version)},\n    hash: ${JSON.stringify(release.md5)},\n    sha256: ${JSON.stringify(sha256)},\n    size: ${release.size},\n    notes: ${JSON.stringify(release.notes)},\n  },\n  and OFFICIAL_G2_SHA256[${JSON.stringify(release.version)}] = ${JSON.stringify(sha256)} in src/lib/firmware.js`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
