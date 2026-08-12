#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: $0 ACTIVE_CADDYFILE EXPECTED_WEBFLASHER_BLOCK OUTPUT_CADDYFILE" >&2
  exit 64
fi

active_caddyfile="$1"
expected_webflasher_block="$2"
output_caddyfile="$3"

for source_file in "${active_caddyfile}" "${expected_webflasher_block}"; do
  if [ ! -f "${source_file}" ] || [ -L "${source_file}" ]; then
    echo "Caddy source is not a regular file: ${source_file}" >&2
    exit 65
  fi
done
if [ -e "${output_caddyfile}" ] || [ -L "${output_caddyfile}" ]; then
  echo "Refusing to overwrite Caddy candidate: ${output_caddyfile}" >&2
  exit 65
fi

active_marker_count="$(grep -c '^# ---- webflasher[.]sybilsight[.]com ' "${active_caddyfile}" || true)"
expected_marker_count="$(grep -c '^# ---- webflasher[.]sybilsight[.]com ' "${expected_webflasher_block}" || true)"
if [ "${active_marker_count}" -ne 1 ] || [ "${expected_marker_count}" -ne 1 ]; then
  echo "Both Caddy sources must contain exactly one WebFlasher site block." >&2
  exit 66
fi

# Prove that the canonical fragment is itself one complete site block before it
# is allowed to replace anything in the production configuration.
"$(dirname "$0")/verify-webflasher-caddy.sh" \
  "${expected_webflasher_block}" "${expected_webflasher_block}"

if ! awk -v replacement_file="${expected_webflasher_block}" '
  BEGIN {
    while ((getline replacement_line < replacement_file) > 0) {
      replacement = replacement replacement_line ORS
    }
    close(replacement_file)
  }
  /^# ---- webflasher[.]sybilsight[.]com / && !replaced {
    printf "%s", replacement
    replacing = 1
    replaced = 1
  }
  replacing {
    opening_line = $0
    closing_line = $0
    depth += gsub(/[{]/, "", opening_line)
    depth -= gsub(/[}]/, "", closing_line)
    if (depth > 0) entered_site = 1
    if (entered_site && depth == 0) replacing = 0
    next
  }
  { print }
  END {
    if (!replaced || replacing) exit 41
  }
' "${active_caddyfile}" > "${output_caddyfile}"; then
  echo "Could not replace the complete production WebFlasher site block." >&2
  exit 67
fi

"$(dirname "$0")/verify-webflasher-caddy.sh" \
  "${output_caddyfile}" "${expected_webflasher_block}"
