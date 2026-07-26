#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseEvenOTA } from "../src/lib/firmware.js";

const CDN_BASE = "https://cdn.evenreal.co/firmware";
const REVIEWED_CFW_SHA256 =
  "d2fb5dcef485b1bb14818b8dc56811b9d278d6fc2b81e56c496c53b72aaa1e86";
const REVIEWED_CFW_BASE_SHA256 =
  "f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa";
const LEGACY_HARDWARE_VALIDATED_CFW_SHA256 =
  "5c1539fd39c599e6035f6a8ec0779ba687c250d342a24c21a39952fed6c56aa0";
const HARDWARE_VALIDATED_TEMPLE_IMAGES = new Set([
  LEGACY_HARDWARE_VALIDATED_CFW_SHA256,
  REVIEWED_CFW_BASE_SHA256,
]);
const RELEASES = [
  {
    version: "2.0.1.14",
    hash: "09fe9c0df7b14385c023bc35a364b3a9",
    size: 3232068,
    fallbacks: [["v2", "firmware/versions/v2.0.1.14/09fe9c0df7b14385c023bc35a364b3a9.bin"]],
  },
  {
    version: "2.0.3.20",
    hash: "57201a6e7cd6dadeee1bdb8f6ed98606",
    size: 3832044,
    fallbacks: [["v2", "firmware/versions/v2.0.3.20/57201a6e7cd6dadeee1bdb8f6ed98606.bin"]],
  },
  {
    version: "2.0.5.12",
    hash: "53486f03b825cb22d13e769187b46656",
    size: 3921853,
    fallbacks: [["v2", "firmware/versions/v2.0.5.12/53486f03b825cb22d13e769187b46656.bin"]],
  },
  {
    version: "2.0.6.14",
    hash: "0c9f9ca58785547278a5103bc6ae7a09",
    size: 3954281,
    fallbacks: [["v2", "firmware/versions/v2.0.6.14/0c9f9ca58785547278a5103bc6ae7a09.bin"]],
  },
  {
    version: "2.0.7.16",
    hash: "650176717d1f30ef684e5f812500903c",
    size: 3958551,
    fallbacks: [["v2", "firmware/versions/v2.0.7.16/650176717d1f30ef684e5f812500903c.bin"]],
  },
  {
    version: "2.0.8.20",
    hash: "d2d778f1b3fd8dad8e12dfc000109657",
    size: 4051861,
    fallbacks: [["v2", "firmware/versions/v2.0.8.20/d2d778f1b3fd8dad8e12dfc000109657.bin"]],
  },
  {
    version: "2.0.9.20",
    hash: "77de41924c3a7e0402921017140c7456",
    size: 4068333,
    fallbacks: [["v2", "firmware/versions/v2.0.9.20/77de41924c3a7e0402921017140c7456.bin"]],
  },
  {
    version: "2.1.1.8",
    hash: "51f4af4b287af7b4572b4b3e59cecb89",
    size: 4076732,
    fallbacks: [["v2", "firmware/versions/v2.1.1.8/51f4af4b287af7b4572b4b3e59cecb89.bin"]],
  },
  {
    version: "2.1.1.12",
    hash: "55c8b82d3d12a82f22453c7e9c8d8e05",
    size: 4082768,
    fallbacks: [[
      "v2",
      "captures/terminal/20260427-225543/sdcard_Android_data_com.even.sg/files/evenTemp/55c8b82d3d12a82f22453c7e9c8d8e05.bin",
    ]],
  },
  {
    version: "2.2.0.24",
    hash: "a0a293189243b71ca581bda1493da1da",
    size: 3997044,
    fallbacks: [[
      "v2",
      "captures/terminal/20260427-225543/sdcard_Android_data_com.even.sg/files/evenTemp/a0a293189243b71ca581bda1493da1da.bin",
    ]],
  },
  {
    version: "2.2.4.34",
    hash: "a6966d807634cc97aec641a0dcca358b",
    size: 4131592,
  },
  {
    version: "2.2.6.10",
    hash: "e28738432d7b612d625331b00383149b",
    size: 4301227,
    fallbacks: [[
      "current",
      "firmware/ota/2026-07-22/g2-2.2.6.10-e28738432d7b612d625331b00383149b.bin",
    ]],
  },
  {
    id: "g2-custom-2.2.6.11",
    version: "2.2.6.11",
    internalVersion: "2.2.6.11",
    baseVersion: "2.2.6.10",
    channel: "custom",
    trust: "reviewed-custom",
    hash: "8a7d12c38c07e43469e266df3055e874",
    sha256: REVIEWED_CFW_SHA256,
    size: 4320415,
    fileName: "g2-2.2.6.11.bin",
    sourceUrl:
      "https://sybilsight.com/firmware-updates/releases/g2-2.2.6.11.bin",
    fallbacks: [[
      "website",
      "firmware-updates/releases/g2-2.2.6.11.bin",
    ]],
    patchUrl:
      "https://sybilsight.com/firmware-updates/patches/cfw_patches-2.2.6.11.json",
    patchFallback:
      "firmware-updates/patches/cfw_patches-2.2.6.11.json",
    patchFileName: "cfw_patches-2.2.6.11.json",
    notes:
      "Reviewed SybilSight CFW built from official G2 2.2.6.10. It reports 2.2.6.11 and EVENCFW/3 so Stock/CFW identity is available before OTA.",
    capabilities: [
      "576×288 image containers",
      "RLE and LZ4 image payloads",
      "8bpp XOR-delta frame updates",
      "Per-lens stereo image pairs",
      "Settings capability field 100",
      "Ring long-press and release events",
    ],
  },
];

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function digest(algorithm, data) {
  return createHash(algorithm).update(data).digest("hex");
}

function applyReviewedPatchSet(stock, patchSet) {
  let result = Buffer.from(stock);
  for (const [index, operation] of patchSet.patches.entries()) {
    const oldBytes = Buffer.from(operation.old, "hex");
    const newBytes = Buffer.from(operation.new, "hex");
    if (
      operation.old.length !== oldBytes.length * 2 ||
      operation.new.length !== newBytes.length * 2
    ) {
      throw new Error(`CFW patch operation ${index + 1} contains malformed hex`);
    }
    if (oldBytes.length === 0) {
      if (operation.offset !== result.length) {
        throw new Error(
          `CFW append operation ${index + 1} targets ${operation.offset}, expected ${result.length}`,
        );
      }
      result = Buffer.concat([result, newBytes]);
      continue;
    }
    if (oldBytes.length !== newBytes.length) {
      throw new Error(`CFW patch operation ${index + 1} changes an in-place length`);
    }
    const found = result.subarray(
      operation.offset,
      operation.offset + oldBytes.length,
    );
    if (!found.equals(oldBytes)) {
      throw new Error(`CFW patch operation ${index + 1} did not match the stock bytes`);
    }
    newBytes.copy(result, operation.offset);
  }
  return result;
}

async function download(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "SybilSight-Firmware-Archive/1.0" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function acquireRelease(release, sourceUrl, fallbackRoots) {
  try {
    return {
      bytes: await download(sourceUrl),
      archivedFrom:
        release.channel === "custom"
          ? "SybilSight reviewed CFW mirror"
          : "Even Realities CDN",
    };
  } catch (downloadError) {
    for (const [rootName, relativePath] of release.fallbacks ?? []) {
      const fallbackPath = path.join(fallbackRoots[rootName], relativePath);
      try {
        return {
          bytes: await readFile(fallbackPath),
          archivedFrom: `${rootName === "v2" ? "SybilSight-v2" : "SybilSight"} local evidence`,
        };
      } catch {
        // Continue through every known local preservation path.
      }
    }
    throw new Error(
      `Could not acquire G2 ${release.version} from the CDN or local evidence: ${downloadError.message}`,
    );
  }
}

async function saveRelease(root, release, fallbackRoots) {
  const directory = path.join(root, release.version);
  await mkdir(directory, { recursive: true });
  const sourceFile = release.fileName ?? `${release.hash}.bin`;
  const sourceUrl = release.sourceUrl ?? `${CDN_BASE}/${sourceFile}`;
  process.stdout.write(
    `Downloading ${release.channel === "custom" ? "reviewed CFW" : "official G2"} ${release.version}… `,
  );
  const { bytes, archivedFrom } = await acquireRelease(
    release,
    sourceUrl,
    fallbackRoots,
  );
  const md5 = digest("md5", bytes);
  const sha256 = digest("sha256", bytes);
  if (bytes.length !== release.size) {
    throw new Error(
      `G2 ${release.version} size ${bytes.length} does not match ${release.size}`,
    );
  }
  if (md5 !== release.hash) {
    throw new Error(`G2 ${release.version} MD5 ${md5} does not match its pinned digest`);
  }
  if (release.sha256 && sha256 !== release.sha256) {
    throw new Error(
      `G2 ${release.version} SHA-256 ${sha256} does not match its pinned digest`,
    );
  }

  const parsed = parseEvenOTA(bytes);
  if (parsed.version !== (release.internalVersion ?? release.version)) {
    throw new Error(
      `G2 ${release.version} bundle reports internal version ${parsed.version}`,
    );
  }

  const files = [];
  async function put(name, data) {
    const target = path.join(directory, name);
    await writeFile(target, data);
    files.push({
      name,
      size: data.length,
      sha256: digest("sha256", data),
    });
  }

  await put(sourceFile, bytes);
  let patchFile = null;
  let patchSha256 = null;
  if (release.patchUrl) {
    let patchBytes;
    try {
      patchBytes = await download(release.patchUrl);
    } catch (downloadError) {
      if (!release.patchFallback) throw downloadError;
      patchBytes = await readFile(
        path.join(fallbackRoots.website, release.patchFallback),
      );
    }
    const patchSet = JSON.parse(patchBytes.toString("utf8"));
    if (
      patchSet.base_sha256 !== REVIEWED_CFW_BASE_SHA256 ||
      patchSet.output_sha256 !== REVIEWED_CFW_SHA256 ||
      patchSet.version !== release.version ||
      patchSet.base_version !== release.baseVersion ||
      !Array.isArray(patchSet.patches) ||
      patchSet.patches.length !== 23
    ) {
      throw new Error("The reviewed CFW patch recipe does not match its pinned trust boundary");
    }
    const baseRelease = RELEASES.find(
      (candidate) =>
        candidate.version === release.baseVersion &&
        (candidate.channel ?? "official") === "official",
    );
    if (!baseRelease) throw new Error("The reviewed CFW stock base is not in the archive");
    const baseFile = baseRelease.fileName ?? `${baseRelease.hash}.bin`;
    const stockBytes = await readFile(
      path.join(root, release.baseVersion, baseFile),
    );
    if (digest("sha256", stockBytes) !== REVIEWED_CFW_BASE_SHA256) {
      throw new Error("The archived CFW stock base does not match its pinned SHA-256");
    }
    const rebuiltCFW = applyReviewedPatchSet(stockBytes, patchSet);
    if (
      digest("sha256", rebuiltCFW) !== REVIEWED_CFW_SHA256 ||
      !rebuiltCFW.equals(bytes)
    ) {
      throw new Error(
        "The reviewed patch recipe does not reproduce the archived CFW byte-for-byte",
      );
    }
    patchFile = release.patchFileName;
    patchSha256 = digest("sha256", patchBytes);
    await put(patchFile, patchBytes);
  }
  for (const component of parsed.components) {
    await put(component.name.replaceAll("/", "_"), component.payload);
    if (component.typeId === 6) {
      await put("firmware_box.raw.bin", parsed.chargingCase.rawImage);
    }
  }

  const metadata = {
    schemaVersion: 2,
    device: "Even Realities G2",
    version: release.version,
    internalVersion: parsed.version,
    channel: release.channel ?? "official",
    trust: release.trust ?? "official-pinned",
    baseVersion: release.baseVersion ?? null,
    notes: release.notes ?? null,
    capabilities: release.capabilities ?? [],
    caseVersion: parsed.chargingCase.version,
    sourceUrl,
    archivedFrom,
    sourceFile,
    sourceMd5: md5,
    sourceSha256: sha256,
    sourceSize: bytes.length,
    patchUrl: release.patchUrl ?? null,
    patchFile,
    patchSha256,
    archivedAt: new Date().toISOString(),
    mainFirmware: parsed.mainFirmware
      ? {
          runBase: `0x${parsed.mainFirmware.runBase.toString(16).padStart(8, "0")}`,
          installedImageSize: parsed.mainFirmware.installedImageSize,
          installedImageEnd: `0x${parsed.mainFirmware.installedImageEnd
            .toString(16)
            .padStart(8, "0")}`,
          crc32: parsed.mainFirmware.crc32
            .toString(16)
            .padStart(8, "0"),
        }
      : null,
    components: parsed.components.map((component) => ({
      name: component.name,
      typeId: component.typeId,
      size: component.payloadSize,
      crc32c: component.crc32c
        .toString(16)
        .padStart(8, "0"),
      sha256: digest("sha256", component.payload),
    })),
    files,
  };
  const metadataBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
  await writeFile(path.join(directory, "metadata.json"), metadataBytes);
  files.push({
    name: "metadata.json",
    size: metadataBytes.length,
    sha256: digest("sha256", metadataBytes),
  });
  const sums = files
    .map((file) => `${file.sha256}  ${file.name}`)
    .sort()
    .join("\n");
  await writeFile(path.join(directory, "SHA256SUMS"), `${sums}\n`);
  process.stdout.write(`verified (${parsed.chargingCase.version} case)\n`);

  return {
    id: release.id ?? `g2-official-${release.version}`,
    channel: release.channel ?? "official",
    trust: release.trust ?? "official-pinned",
    version: release.version,
    internalVersion: parsed.version,
    baseVersion: release.baseVersion ?? null,
    notes: release.notes ?? null,
    capabilities: release.capabilities ?? [],
    recoveryTarget: release.channel === "custom" ? "glasses" : "case-and-glasses-bundle",
    caseRecoveryEligible: release.channel !== "custom",
    caseVersion: parsed.chargingCase.version,
    url: `/firmware-updates/source-files/${release.version}/${sourceFile}`,
    sourceUrl,
    fileName: sourceFile,
    size: bytes.length,
    md5,
    sha256,
    patchUrl: release.patchUrl
      ? `/firmware-updates/source-files/${release.version}/${patchFile}`
      : null,
    patchSha256,
    archivedFrom,
    mainFirmware: metadata.mainFirmware,
    components: metadata.components,
  };
}

// Emits the temple writer's compiled-in allowlist. It is deliberately a source
// file rather than something read from index.json at runtime: the writer's final
// trust gate must not be widenable by a tampered catalog.
async function writeTempleFlashTargets(releases) {
  const targets = [
    {
      imageSha256: LEGACY_HARDWARE_VALIDATED_CFW_SHA256,
      mainSha256:
        "38dea7dc05e832e6f5aea8fa726454b2ec44055af5d456b323448ee6989e53d1",
      mainBytes: 3539474,
      version: "2.2.6.10",
      label: "Legacy reviewed SybilSight CFW 2.2.6.10",
      hardwareValidated: true,
    },
  ];
  for (const release of releases) {
    const main = (release.components ?? []).find(
      (component) =>
        component.name === "ota/s200_firmware_ota.bin" && component.typeId === 0,
    );
    if (!main?.sha256) continue;
    const custom = release.channel === "custom";
    targets.push({
      imageSha256: release.sha256,
      mainSha256: main.sha256,
      mainBytes: main.size,
      version: release.internalVersion ?? release.version,
      label: custom
        ? `Reviewed SybilSight CFW ${release.version}`
        : `Stock Even Realities G2 ${release.version}`,
      // Only images with a recorded successful hardware transfer may claim this.
      hardwareValidated: HARDWARE_VALIDATED_TEMPLE_IMAGES.has(release.sha256),
    });
  }
  const entries = targets
    .map(
      (target) =>
        `  Object.freeze({\n` +
        `    imageSha256: ${JSON.stringify(target.imageSha256)},\n` +
        `    mainSha256: ${JSON.stringify(target.mainSha256)},\n` +
        `    mainBytes: ${target.mainBytes},\n` +
        `    version: ${JSON.stringify(target.version)},\n` +
        `    label: ${JSON.stringify(target.label)},\n` +
        `    hardwareValidated: ${target.hardwareValidated},\n` +
        `  })`,
    )
    .join(",\n");
  const source = `// GENERATED FILE — do not edit by hand.
// Rebuild with: npm run archive:firmware
//
// Every Apollo-main payload that the temple writer is permitted to install.
// This table is the writer's own trust root: it is compiled into the bundle and
// is deliberately independent of the fetched firmware catalog, so a tampered
// index.json cannot widen what may be written to a temple.
//
// hardwareValidated marks images whose case-USB temple transfer has actually
// been exercised on hardware. Pinned-but-unvalidated images are still gated on
// exact hashes; they simply have no transfer evidence behind them yet.

export const TEMPLE_FLASH_TARGETS = Object.freeze([
${entries},
]);

export function findTempleFlashTarget(imageSha256) {
  if (typeof imageSha256 !== "string") return null;
  const digest = imageSha256.toLowerCase();
  return TEMPLE_FLASH_TARGETS.find((t) => t.imageSha256 === digest) ?? null;
}
`;
  const here = path.dirname(fileURLToPath(import.meta.url));
  await writeFile(path.join(here, "..", "src", "lib", "templeFlashTargets.js"), source);
  return targets.length;
}

async function main() {
  const defaultOutput = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../firmware-archive/source-files",
  );
  const output = path.resolve(argument("--output", defaultOutput));
  const fallbackRoots = {
    v2: path.resolve(
      argument("--sybilsight-v2", path.join(os.homedir(), "Repo/SybilSight-v2")),
    ),
    current: path.resolve(
      argument("--sybilsight", path.join(os.homedir(), "Repo/SybilSight")),
    ),
    website: path.resolve(
      argument(
        "--sybilsight-website",
        path.join(os.homedir(), "Repo/sybilsight-website"),
      ),
    ),
  };
  await mkdir(output, { recursive: true });
  const catalog = [];
  for (const release of RELEASES) {
    catalog.push(await saveRelease(output, release, fallbackRoots));
  }
  const index = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    source: "Even Realities CDN plus SybilSight/SybilSight-v2 release evidence",
    releases: catalog.sort((left, right) => {
      const versionOrder = right.version.localeCompare(left.version, undefined, {
        numeric: true,
      });
      if (versionOrder !== 0) return versionOrder;
      return left.channel === "custom" ? -1 : 1;
    }),
  };
  await writeFile(
    path.join(output, "index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  const targets = await writeTempleFlashTargets(index.releases);
  process.stdout.write(`Archived ${catalog.length} verified G2 releases in ${output}\n`);
  process.stdout.write(
    `Pinned ${targets} temple-flash Apollo-main target(s) in src/lib/templeFlashTargets.js\n`,
  );
}

await main();
