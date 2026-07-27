export const YHM_PROFILE_REVIEWED_22 = "reviewed-22";
export const YHM_PROFILE_OBSERVED_33 = "observed-33";

const REVIEWED_22_BASELINES = Object.freeze([
  "811104afaf038d2022ff",
  "810004aeae03812022ff",
  "811104afaf03812022ff",
  "810104afae03812022ff",
  "811004aeaf03812022ff",
]);

const OBSERVED_33_BASELINES = Object.freeze([
  REVIEWED_22_BASELINES[0],
  `${REVIEWED_22_BASELINES[1].slice(0, -4)}33ff`,
  REVIEWED_22_BASELINES[2],
  `${REVIEWED_22_BASELINES[3].slice(0, -4)}33ff`,
  `${REVIEWED_22_BASELINES[4].slice(0, -4)}33ff`,
]);

export const YHM_PROFILE_BASELINES = Object.freeze({
  [YHM_PROFILE_REVIEWED_22]: REVIEWED_22_BASELINES,
  [YHM_PROFILE_OBSERVED_33]: OBSERVED_33_BASELINES,
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
