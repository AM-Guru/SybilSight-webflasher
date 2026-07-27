const BUILD_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export const WEBFLASHER_BUILD_SHA =
  typeof __WEBFLASHER_BUILD_SHA__ === "string"
    ? __WEBFLASHER_BUILD_SHA__.toLowerCase()
    : "development";

export const WEBFLASHER_BUILD_LABEL = BUILD_SHA_PATTERN.test(
  WEBFLASHER_BUILD_SHA,
)
  ? WEBFLASHER_BUILD_SHA.slice(0, 7)
  : WEBFLASHER_BUILD_SHA;

export class WebFlasherReleaseIntegrityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "WebFlasherReleaseIntegrityError";
    this.releaseIntegrity = details;
  }
}

function requireBuildSha(value, label) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!BUILD_SHA_PATTERN.test(normalized)) {
    throw new WebFlasherReleaseIntegrityError(
      `${label} did not provide a valid 40-character Git commit identity. No device mutation was started.`,
      { observed: normalized || null },
    );
  }
  return normalized;
}

export async function assertCurrentWebFlasherRelease({
  fetchImpl = globalThis.fetch,
  currentBuildSha = WEBFLASHER_BUILD_SHA,
  releaseUrl = "/release.json",
  cacheToken = Date.now(),
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new WebFlasherReleaseIntegrityError(
      "This browser cannot verify the deployed WebFlasher release. No device mutation was started.",
    );
  }
  const runningSha = requireBuildSha(
    currentBuildSha,
    "The running WebFlasher",
  );
  const separator = releaseUrl.includes("?") ? "&" : "?";
  const url =
    `${releaseUrl}${separator}running=${encodeURIComponent(runningSha)}` +
    `&fresh=${encodeURIComponent(String(cacheToken))}`;
  let response;
  try {
    response = await fetchImpl(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new WebFlasherReleaseIntegrityError(
      `The deployed WebFlasher release could not be verified: ${error instanceof Error ? error.message : String(error)}. Reload while online before changing device firmware. No device mutation was started.`,
      { runningSha },
    );
  }
  if (!response?.ok) {
    throw new WebFlasherReleaseIntegrityError(
      `The deployed WebFlasher release could not be verified (HTTP ${response?.status ?? "unknown"}). Reload while online before changing device firmware. No device mutation was started.`,
      { runningSha, httpStatus: response?.status ?? null },
    );
  }

  let manifest;
  try {
    manifest = await response.json();
  } catch {
    throw new WebFlasherReleaseIntegrityError(
      "The deployed WebFlasher release manifest is not valid JSON. No device mutation was started.",
      { runningSha },
    );
  }
  if (manifest?.schemaVersion !== 1) {
    throw new WebFlasherReleaseIntegrityError(
      "The deployed WebFlasher release manifest has an unsupported schema. No device mutation was started.",
      { runningSha, schemaVersion: manifest?.schemaVersion ?? null },
    );
  }
  const deployedSha = requireBuildSha(
    manifest.buildSha,
    "The deployed WebFlasher release manifest",
  );
  if (runningSha !== deployedSha) {
    throw new WebFlasherReleaseIntegrityError(
      `This browser tab is running WebFlasher ${runningSha.slice(0, 7)}, but the deployed release is ${deployedSha.slice(0, 7)}. Reload this page before changing device firmware. No device mutation was started.`,
      {
        runningSha,
        deployedSha,
        stale: true,
      },
    );
  }
  return {
    schemaVersion: 1,
    runningSha,
    deployedSha,
    verified: true,
  };
}
