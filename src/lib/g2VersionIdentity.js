import { TEMPLE_FLASH_TARGETS } from "./templeFlashTargets.js";

// Stock and custom firmware may deliberately report the same donor version.
// A Case/GATT version reply cannot distinguish those images in either direction.
export function g2VersionCanIdentifyTarget(firmware, reportedVersion) {
  if (!reportedVersion || firmware?.templeFlashTarget?.requiredCfwMarker) return false;
  const matchingHashes = new Set(TEMPLE_FLASH_TARGETS
    .filter((target) => (target.reportedVersion ?? target.version) === reportedVersion)
    .map((target) => target.imageSha256));
  return matchingHashes.size <= 1;
}
