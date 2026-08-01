#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { parseEvenOTA } from "../src/lib/firmware.js";

const CDN_BASE = "https://cdn.evenreal.co/firmware";
const REVIEWED_CFW_2_2_6_12_SHA256 =
  "b4de0cd3ffce5b0c756a7625b5250378d7680637e82849b15291a56a279fb4cd";
const REVIEWED_CFW_2_2_6_11_SHA256 =
  "d2fb5dcef485b1bb14818b8dc56811b9d278d6fc2b81e56c496c53b72aaa1e86";
const REVIEWED_CFW_BASE_SHA256 =
  "f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa";
const LEGACY_HARDWARE_VALIDATED_CFW_SHA256 =
  "5c1539fd39c599e6035f6a8ec0779ba687c250d342a24c21a39952fed6c56aa0";
const R1_RELEASES = [
  {
    id: "r1-official-2.2.7.0005",
    displayName: "Official R1 2.2.7.0005",
    version: "2.2.7.0005",
    channel: "official",
    trust: "official-pinned",
    format: "nordic-secure-dfu",
    fileName: "r1-2.2.7.0005-be359b28954f8fe4a94ec21a58415d59.zip",
    size: 650007,
    md5: "be359b28954f8fe4a94ec21a58415d59",
    sha256: "6222e4bb334b531c3d2cfedfae2a26f609f0ffd99bd60a50bc8cced645c9eba5",
    sourceUrl:
      "https://cdn.evenreal.co/firmware/be359b28954f8fe4a94ec21a58415d59.zip",
    minAppVersion: "2.2.7",
    notes:
      "Enhanced Bluetooth connection stability and fixed health data collection failures in specific scenarios.",
    application: {
      binFile: "application.bin",
      binSize: 649376,
      binSha256:
        "2d38253e00b887ced3f1e2c049db21254b0974091bc954a82c13e21c48b064c2",
      datFile: "application.dat",
      datSize: 141,
      datSha256:
        "68447d4dfc0ad7d77270797fe0dbf4311faef7eb5e275342033e5b373be93be9",
    },
    initPacket: {
      applicationVersion: 3,
      hardwareVersion: 52,
      softDeviceFirmwareIds: [0x0100],
      signed: true,
    },
  },
  {
    id: "r1-official-2.2.6.0009",
    displayName: "Official R1 2.2.6.0009",
    version: "2.2.6.0009",
    channel: "official",
    trust: "official-pinned",
    format: "nordic-secure-dfu",
    fileName: "r1-2.2.6.0009-9eca8ae9d5117abda4f72f39bdb44ad2.zip",
    size: 647039,
    md5: "9eca8ae9d5117abda4f72f39bdb44ad2",
    sha256: "492baf487734720732f82f404624e0c3b3af3b01d30727366238e154164ad0dd",
    sourceUrl:
      "https://cdn.evenreal.co/firmware/r1-2.2.6.0009-9eca8ae9d5117abda4f72f39bdb44ad2.zip",
    fallbacks: [[
      "current",
      "firmware/ota/2026-07-22/r1-2.2.6.0009-9eca8ae9d5117abda4f72f39bdb44ad2.zip",
    ]],
    application: {
      binFile: "application.bin",
      binSize: 646408,
      binSha256:
        "0e788d433ea50fd36edb8f21a9c18b6062211e4a36dbc5bd7695ea5827f3aa1a",
      datFile: "application.dat",
      datSize: 141,
      datSha256:
        "305da36784e527b3e434f2cf45019a290bf5c14cbceb2e57c9e61dcdfdb1f253",
    },
    initPacket: {
      applicationVersion: 3,
      hardwareVersion: 52,
      softDeviceFirmwareIds: [0x0100],
      signed: true,
    },
  },
];
// Reviewed CFW 2.2.6.11. Case-USB temple transfer exercised end to end on
// 2026-07-28: right temple Stock 2.2.6.10 -> CFW 2.2.6.11, all 3,543 records
// and FINISH accepted, image activated on the first activation reset, and the
// post-reset version reply verified on both temples.
const HARDWARE_VALIDATED_TEMPLE_IMAGES = new Set([
  LEGACY_HARDWARE_VALIDATED_CFW_SHA256,
  REVIEWED_CFW_BASE_SHA256,
  REVIEWED_CFW_2_2_6_11_SHA256,
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
    version: "2.2.7.14",
    hash: "ededa3729ef16cb2948fa54c44e1dd09",
    sha256: "0fced0aebcc6c88db6f76dba34f91b805d842a5fc297bfd7fa6d6a34ec83cecb",
    size: 4335715,
    notes:
      "Enhanced Bluetooth connection stability and Teleprompt AI noise reduction; fixed Teleprompt Remote Control and earlier-version firmware update failures in specific scenarios.",
  },
  {
    id: "g2-custom-2.2.6.12",
    displayName: "SybilSight CFW (2.2.6.12)",
    version: "2.2.6.12",
    internalVersion: "2.2.6.12",
    baseVersion: "2.2.6.10",
    baseSha256: REVIEWED_CFW_BASE_SHA256,
    channel: "custom",
    trust: "reviewed-custom",
    hash: "af10fac70eb60f158ac6ba98eef7f54c",
    sha256: REVIEWED_CFW_2_2_6_12_SHA256,
    size: 4316319,
    fileName: "g2-2.2.6.12.bin",
    sourceUrl:
      "https://webflasher.sybilsight.com/firmware-updates/source-files/2.2.6.12/g2-2.2.6.12.bin",
    fallbacks: [[
      "webflasher",
      "public/firmware-updates/source-files/2.2.6.12/g2-2.2.6.12.bin",
    ]],
    patchUrl:
      "https://webflasher.sybilsight.com/firmware-updates/source-files/2.2.6.12/cfw_patches-2.2.6.12.json",
    patchFallbackRoot: "webflasher",
    patchFallback:
      "public/firmware-updates/source-files/2.2.6.12/cfw_patches-2.2.6.12.json",
    patchFileName: "cfw_patches-2.2.6.12.json",
    patchCount: 20,
    manifestFileName: "manifest.json",
    notes:
      "SybilSight CFW 2.2.6.12 built from official G2 2.2.6.10 with the current CFW image, gesture, timing, and full-panel direct-framebuffer patches. The Faceclaw settings controls, wake takeover, Even AI interception, and framebuffer lease are excluded. The image is reproducibly built and statically reviewed but not yet hardware-flashed.",
    capabilities: [
      "576×288 image containers",
      "640×480 full-panel custom image surface",
      "Zlib and RLE image payloads",
      "Direct packed-4bpp framebuffer presentation",
      "Atomic multi-segment and rectangle-copy updates",
      "Per-lens stereo image operations",
      "Snapshot FIFO and on-device timing diagnostics",
      "Buzzer presets, notes, raw tones, and sequences",
      "Settings capability field 100",
      "Ring long-press and release events",
    ],
  },
  {
    id: "g2-custom-2.2.6.11",
    displayName: "SybilSight CFW (2.2.6.11)",
    version: "2.2.6.11",
    internalVersion: "2.2.6.11",
    baseVersion: "2.2.6.10",
    baseSha256: REVIEWED_CFW_BASE_SHA256,
    channel: "custom",
    trust: "reviewed-custom",
    hash: "8a7d12c38c07e43469e266df3055e874",
    sha256: REVIEWED_CFW_2_2_6_11_SHA256,
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
    patchCount: 23,
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
          archivedFrom: `${{
            v2: "SybilSight-v2",
            current: "SybilSight",
            website: "SybilSight website",
            webflasher: "WebFlasher",
          }[rootName] ?? rootName} local evidence`,
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
  let patchSet = null;
  if (release.patchUrl) {
    let patchBytes;
    try {
      patchBytes = await download(release.patchUrl);
    } catch (downloadError) {
      if (!release.patchFallback) throw downloadError;
      patchBytes = await readFile(
        path.join(
          fallbackRoots[release.patchFallbackRoot ?? "website"],
          release.patchFallback,
        ),
      );
    }
    patchSet = JSON.parse(patchBytes.toString("utf8"));
    const patchVersion = patchSet.release_version ?? patchSet.version;
    const patchBaseVersion =
      patchSet.vendor_base_version ?? patchSet.base_version;
    const baseRelease = RELEASES.find(
      (candidate) =>
        candidate.version === release.baseVersion &&
        (candidate.channel ?? "official") === "official",
    );
    if (!baseRelease) throw new Error("The reviewed CFW stock base is not in the archive");
    if (
      patchSet.base_sha256 !== release.baseSha256 ||
      patchSet.output_sha256 !== release.sha256 ||
      patchVersion !== release.version ||
      patchBaseVersion !== release.baseVersion ||
      !Array.isArray(patchSet.patches) ||
      patchSet.patches.length !== release.patchCount
    ) {
      throw new Error("The reviewed CFW patch recipe does not match its pinned trust boundary");
    }
    const baseFile = baseRelease.fileName ?? `${baseRelease.hash}.bin`;
    const stockBytes = await readFile(
      path.join(root, release.baseVersion, baseFile),
    );
    if (digest("sha256", stockBytes) !== release.baseSha256) {
      throw new Error("The archived CFW stock base does not match its pinned SHA-256");
    }
    const rebuiltCFW = applyReviewedPatchSet(stockBytes, patchSet);
    if (
      digest("sha256", rebuiltCFW) !== release.sha256 ||
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

  let manifestFile = null;
  let manifestSha256 = null;
  if (release.manifestFileName) {
    manifestFile = release.manifestFileName;
    const firmwareFiles = parsed.components.map((component) => ({
      componentName: component.name,
      archiveFile: component.name.replaceAll("/", "_"),
      typeId: component.typeId,
      size: component.payloadSize,
      crc32c: component.crc32c.toString(16).padStart(8, "0"),
      sha256: digest("sha256", component.payload),
      role:
        component.typeId === 0
          ? "glasses-application"
          : component.typeId === 1
            ? "glasses-bootloader"
            : component.typeId === 6
              ? "charging-case"
              : "device-component",
    }));
    const manifest = {
      schemaVersion: 1,
      format: "evenota-hardware-flash-manifest-v1",
      device: "Even Realities G2",
      release: {
        version: release.version,
        internalVersion: parsed.version,
        channel: release.channel ?? "official",
        trust: release.trust ?? "official-pinned",
        baseVersion: release.baseVersion ?? null,
        hardwareValidated: HARDWARE_VALIDATED_TEMPLE_IMAGES.has(sha256),
      },
      package: {
        file: sourceFile,
        size: bytes.length,
        md5,
        sha256,
        componentCount: parsed.components.length,
      },
      patchRecipe: patchFile
        ? {
            file: patchFile,
            sha256: patchSha256,
            baseVersion: release.baseVersion,
            baseSha256: release.baseSha256,
            operationCount: patchSet.patches.length,
          }
        : null,
      capabilityMarker: patchSet?.capability_marker ?? null,
      sourceProvenance: patchSet?.source_provenance ?? null,
      excludedFeature: patchSet?.source_provenance?.excluded_feature ?? null,
      firmwareFiles,
      chargingCaseRawImage: {
        file: "firmware_box.raw.bin",
        size: parsed.chargingCase.rawImage.length,
        sha256: digest("sha256", parsed.chargingCase.rawImage),
      },
      flashTargets: {
        completeBundle: sourceFile,
        glassesApplication: "ota_s200_firmware_ota.bin",
        glassesBootloader: "ota_s200_bootloader.bin",
        chargingCaseWrapped: "firmware_box.bin",
        chargingCaseRaw: "firmware_box.raw.bin",
      },
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    manifestSha256 = digest("sha256", manifestBytes);
    await put(manifestFile, manifestBytes);
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
    manifestFile,
    manifestSha256,
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
    ...(release.displayName ? { displayName: release.displayName } : {}),
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
    ...(manifestFile
      ? {
          manifestUrl: `/firmware-updates/source-files/${release.version}/${manifestFile}`,
          manifestSha256,
        }
      : {}),
    archivedFrom,
    mainFirmware: metadata.mainFirmware,
    components: metadata.components,
  };
}

async function saveRingRelease(root, release, fallbackRoots) {
  const directory = path.join(root, "r1", release.version);
  await mkdir(directory, { recursive: true });
  process.stdout.write(`Acquiring official R1 ${release.version}… `);
  const { bytes, archivedFrom } = await acquireRelease(
    release,
    release.sourceUrl,
    fallbackRoots,
  );
  if (
    bytes.length !== release.size ||
    digest("md5", bytes) !== release.md5 ||
    digest("sha256", bytes) !== release.sha256
  ) {
    throw new Error(`R1 ${release.version} ZIP does not match its pinned size and digests`);
  }

  const files = unzipSync(bytes);
  const fileNames = Object.keys(files).sort();
  if (
    JSON.stringify(fileNames) !==
    JSON.stringify(["application.bin", "application.dat", "manifest.json"])
  ) {
    throw new Error(`R1 ${release.version} ZIP contains an unexpected file set`);
  }
  const manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString("utf8"));
  const declared = manifest?.manifest?.application;
  if (
    declared?.bin_file !== release.application.binFile ||
    declared?.dat_file !== release.application.datFile
  ) {
    throw new Error(`R1 ${release.version} manifest does not select the pinned application`);
  }
  const application = Buffer.from(files[release.application.binFile]);
  const initPacket = Buffer.from(files[release.application.datFile]);
  if (
    application.length !== release.application.binSize ||
    digest("sha256", application) !== release.application.binSha256 ||
    initPacket.length !== release.application.datSize ||
    digest("sha256", initPacket) !== release.application.datSha256
  ) {
    throw new Error(`R1 ${release.version} application components failed verification`);
  }

  await writeFile(path.join(directory, release.fileName), bytes);
  await writeFile(path.join(directory, release.application.binFile), application);
  await writeFile(path.join(directory, release.application.datFile), initPacket);
  await writeFile(path.join(directory, "manifest.json"), files["manifest.json"]);
  const metadata = {
    schemaVersion: 2,
    device: "Even Realities R1",
    version: release.version,
    channel: release.channel,
    trust: release.trust,
    format: release.format,
    sourceUrl: release.sourceUrl,
    archivedFrom,
    archivedAt: new Date().toISOString(),
    sourceFile: release.fileName,
    sourceMd5: release.md5,
    sourceSha256: release.sha256,
    sourceSize: release.size,
    minAppVersion: release.minAppVersion ?? null,
    notes: release.notes ?? null,
    application: release.application,
    initPacket: release.initPacket,
  };
  await writeFile(
    path.join(directory, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  await writeFile(
    path.join(directory, "SHA256SUMS"),
    [
      `${release.application.binSha256}  ${release.application.binFile}`,
      `${release.application.datSha256}  ${release.application.datFile}`,
      `${release.sha256}  ${release.fileName}`,
    ].join("\n") + "\n",
  );
  process.stdout.write("verified (signed Nordic Secure DFU)\n");
  return {
    id: release.id,
    displayName: release.displayName,
    channel: release.channel,
    trust: release.trust,
    version: release.version,
    format: release.format,
    url: `/firmware-updates/source-files/r1/${release.version}/${release.fileName}`,
    sourceUrl: release.sourceUrl,
    fileName: release.fileName,
    size: release.size,
    md5: release.md5,
    sha256: release.sha256,
    archivedFrom,
    minAppVersion: release.minAppVersion ?? null,
    notes: release.notes ?? null,
    application: release.application,
    initPacket: release.initPacket,
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
        ? release.displayName ?? `SybilSight CFW (${release.version})`
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
    webflasher: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    ),
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
  const ringCatalog = [];
  for (const release of R1_RELEASES) {
    ringCatalog.push(await saveRingRelease(output, release, fallbackRoots));
  }
  const index = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    source: "Even Realities G2/R1 CDN plus SybilSight release evidence",
    releases: catalog.sort((left, right) => {
      const versionOrder = right.version.localeCompare(left.version, undefined, {
        numeric: true,
      });
      if (versionOrder !== 0) return versionOrder;
      return left.channel === "custom" ? -1 : 1;
    }),
    ringReleases: ringCatalog.sort((left, right) =>
      right.version.localeCompare(left.version, undefined, { numeric: true }),
    ),
  };
  await writeFile(
    path.join(output, "index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  const targets = await writeTempleFlashTargets(index.releases);
  process.stdout.write(`Archived ${catalog.length} verified G2 releases in ${output}\n`);
  process.stdout.write(`Archived ${ringCatalog.length} verified R1 release(s)\n`);
  process.stdout.write(
    `Pinned ${targets} temple-flash Apollo-main target(s) in src/lib/templeFlashTargets.js\n`,
  );
}

await main();
