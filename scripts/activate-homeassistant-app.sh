#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 APP_SLUG SOURCE_DIRECTORY" >&2
  exit 64
fi

app_slug="$1"
source_directory="$2"

case "${app_slug}" in
  local_sybilsight_remote_support) ;;
  *)
    echo "Refusing unexpected Home Assistant app: ${app_slug}" >&2
    exit 65
    ;;
esac

expected_source_directory="${EXPECTED_HOME_ASSISTANT_APP_SOURCE:-/addons/sybilsight-remote-support}"
if [ "${source_directory}" != "${expected_source_directory}" ] || \
  [ ! -d "${source_directory}" ] || [ -L "${source_directory}" ]; then
  echo "Refusing unexpected Home Assistant app source: ${source_directory}" >&2
  exit 65
fi

for required_command in ha jq sed sleep; do
  command -v "${required_command}" >/dev/null
done

source_version="$(sed -n 's/^version:[[:space:]]*"\([^"]*\)"[[:space:]]*$/\1/p' \
  "${source_directory}/config.yaml")"
case "${source_version}" in
  ""|*[!0-9A-Za-z.-]*)
    echo "Could not read a safe app version from ${source_directory}/config.yaml" >&2
    exit 66
    ;;
esac

# Local app metadata is cached by Supervisor. Refresh it after the atomic
# source-directory swap so version_latest describes the source just deployed.
ha store reload --no-progress

app_info="$(ha apps info "${app_slug}" --raw-json)"
installed_version="$(printf '%s' "${app_info}" | jq -er '.data.version // empty')"
available_version="$(printf '%s' "${app_info}" | jq -er '.data.version_latest // empty')"
update_available="$(printf '%s' "${app_info}" | jq -er '.data.update_available | tostring')"

if [ "${available_version}" != "${source_version}" ]; then
  echo "Supervisor reports app source ${available_version}, expected ${source_version}" >&2
  exit 67
fi

if [ "${installed_version}" = "${source_version}" ]; then
  action=rebuild
elif [ "${update_available}" = true ]; then
  action=update
else
  echo "App ${app_slug} cannot move from ${installed_version} to ${source_version}" >&2
  exit 68
fi

action_status=0
ha apps "${action}" "${app_slug}" --no-progress || action_status=$?

# The CLI can time out while Supervisor finishes a successful build. Trust the
# resulting version and running state, not only the command's exit status.
attempt=0
while [ "${attempt}" -lt 12 ]; do
  app_info="$(ha apps info "${app_slug}" --raw-json)"
  observed_version="$(printf '%s' "${app_info}" | jq -er '.data.version // empty')"
  observed_state="$(printf '%s' "${app_info}" | jq -er '.data.state // empty')"
  if [ "${observed_version}" = "${source_version}" ] && \
    [ "${observed_state}" = started ]; then
    echo "Activated Home Assistant app ${app_slug} ${source_version} with ${action}"
    exit 0
  fi
  attempt=$((attempt + 1))
  [ "${attempt}" -ge 12 ] || sleep 5
done

echo "App ${app_slug} did not reach started version ${source_version} after ${action}" >&2
if [ "${action_status}" -ne 0 ]; then
  exit "${action_status}"
fi
exit 69
