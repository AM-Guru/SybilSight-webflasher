#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 ACTIVE_CADDYFILE EXPECTED_WEBFLASHER_BLOCK" >&2
  exit 64
fi

active_caddyfile="$1"
expected_webflasher_block="$2"

if [ ! -f "${active_caddyfile}" ] || [ -L "${active_caddyfile}" ]; then
  echo "Active Caddyfile is not a regular file: ${active_caddyfile}" >&2
  exit 65
fi
if [ ! -f "${expected_webflasher_block}" ] || [ -L "${expected_webflasher_block}" ]; then
  echo "Expected WebFlasher Caddy block is not a regular file: ${expected_webflasher_block}" >&2
  exit 65
fi

active_marker_count="$(grep -c '^# ---- webflasher[.]sybilsight[.]com ' "${active_caddyfile}" || true)"
if [ "${active_marker_count}" -ne 1 ]; then
  echo "Active Caddyfile must contain exactly one WebFlasher site block." >&2
  exit 66
fi

observed_webflasher_block="$(mktemp "${TMPDIR:-/tmp}/webflasher-caddy.XXXXXX")"
cleanup() {
  rm -f "${observed_webflasher_block}"
}
trap cleanup EXIT HUP INT TERM

if ! awk '
  BEGIN {
    collecting = 0
    found = 0
    complete = 0
    depth = 0
  }
  /^# ---- webflasher[.]sybilsight[.]com / {
    collecting = 1
    found = 1
  }
  collecting {
    print
    opening_line = $0
    closing_line = $0
    depth += gsub(/[{]/, "", opening_line)
    depth -= gsub(/[}]/, "", closing_line)
    if (depth > 0) entered_site = 1
    if (entered_site && depth == 0) {
      complete = 1
      exit
    }
  }
  END {
    if (!found || !complete) exit 41
  }
' "${active_caddyfile}" > "${observed_webflasher_block}"; then
  echo "Active Caddyfile has no complete WebFlasher site block." >&2
  exit 66
fi

if ! cmp -s "${expected_webflasher_block}" "${observed_webflasher_block}"; then
  echo "Active WebFlasher Caddy block does not match the deployment source." >&2
  exit 67
fi
