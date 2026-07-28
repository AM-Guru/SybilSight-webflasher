export const YHM_PROFILE_REVIEWED_22 = "reviewed-22";
export const YHM_PROFILE_OBSERVED_33 = "observed-33";
export const YHM_PROFILE_OBSERVED_45 = "observed-45";

const REVIEWED_22_BASELINES = Object.freeze([
  "811104afaf038d2022ff",
  "810004aeae03812022ff",
  "811104afaf03812022ff",
  "810104afae03812022ff",
  "811004aeaf03812022ff",
]);

// This list mirrors the five-slot baseline table baked into the pinned SRAM
// bridges byte-for-byte; the observed-33 bridges are derived from the reviewed
// build by patching each listed entry's register-8 byte 0x22 -> 0x33.
const OBSERVED_33_BASELINES = Object.freeze([
  REVIEWED_22_BASELINES[0],
  `${REVIEWED_22_BASELINES[1].slice(0, -4)}33ff`,
  // Remote support 2026-07-28, case 00240024514250032037384b: both temples
  // held this 33-suffix variant of seated-idle entry 2 through every settle
  // attempt, with byte-for-byte retained-SRAM zero-write proof on each bridge
  // run and clean version/status frames once the bridge proceeded.
  `${REVIEWED_22_BASELINES[2].slice(0, -4)}33ff`,
  `${REVIEWED_22_BASELINES[3].slice(0, -4)}33ff`,
  `${REVIEWED_22_BASELINES[4].slice(0, -4)}33ff`,
]);

// Remote support 2026-07-28, case 001d00115845501820373941: six retained
// zero-write proofs across two bilateral resets and the full settle ladder
// held 45-suffix variants of seated-idle entries 2-4 while the charging bytes
// cycled normally (00/01/11, ae/af), so register 8 is persistent for this
// Case rather than a charging phase.
const OBSERVED_45_BASELINES = Object.freeze([
  REVIEWED_22_BASELINES[0],
  `${REVIEWED_22_BASELINES[1].slice(0, -4)}45ff`,
  `${REVIEWED_22_BASELINES[2].slice(0, -4)}45ff`,
  `${REVIEWED_22_BASELINES[3].slice(0, -4)}45ff`,
  `${REVIEWED_22_BASELINES[4].slice(0, -4)}45ff`,
]);

export const YHM_PROFILE_BASELINES = Object.freeze({
  [YHM_PROFILE_REVIEWED_22]: REVIEWED_22_BASELINES,
  [YHM_PROFILE_OBSERVED_33]: OBSERVED_33_BASELINES,
  [YHM_PROFILE_OBSERVED_45]: OBSERVED_45_BASELINES,
});

// Register-8 byte written into the four patchable baseline-table slots of the
// pinned SRAM bridges when deriving an observed profile from the reviewed
// build. The first (0x8d) table entry is never patched.
export const YHM_PROFILE_PATCH_BYTES = Object.freeze({
  [YHM_PROFILE_OBSERVED_33]: 0x33,
  [YHM_PROFILE_OBSERVED_45]: 0x45,
});

export function requireYhmProfile(profile) {
  if (!Object.hasOwn(YHM_PROFILE_BASELINES, profile)) {
    throw new Error(`Unsupported YHM baseline profile ${profile ?? "unknown"}.`);
  }
  return profile;
}

export function identifyYhmBaselineProfile(baselineHex) {
  const normalized = String(baselineHex ?? "").toLowerCase();
  for (const [profile, baselines] of Object.entries(YHM_PROFILE_BASELINES)) {
    if (baselines.includes(normalized)) return profile;
  }
  return null;
}

export function isYhmBaselineAllowed(profile, baselineHex) {
  requireYhmProfile(profile);
  return YHM_PROFILE_BASELINES[profile].includes(
    String(baselineHex ?? "").toLowerCase(),
  );
}
