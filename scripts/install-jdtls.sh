#!/usr/bin/env bash
set -euo pipefail

readonly JDTLS_UPSTREAM_VERSION="1.63.0-202610191322"
readonly JDTLS_VERSION="${JDTLS_UPSTREAM_VERSION}-idecompact1"
readonly JDTLS_ARTIFACT="jdt-language-server-${JDTLS_UPSTREAM_VERSION}.tar.gz"
readonly JDTLS_URL="https://download.eclipse.org/jdtls/milestones/1.63.0/${JDTLS_ARTIFACT}"
readonly JDTLS_CHECKSUM_URL="${JDTLS_URL}.sha256"
readonly JDTLS_SHA256="b1f2abe0b3cccb462cf64fb4a5587c7d09df60cf8be7748b152cbd89d018bdc4"
readonly DATA_HOME="${XDG_DATA_HOME:-${HOME:?HOME must be set}/.local/share}"
readonly INSTALL_ROOT="${DATA_HOME}/ide/tools/jdtls"
readonly VERSION_DIR="${INSTALL_ROOT}/${JDTLS_VERSION}"
readonly CURRENT_LINK="${INSTALL_ROOT}/current"
readonly JDTLS_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly JDTLS_PATCH_BUILDER="${JDTLS_SCRIPT_DIR}/prepare-jdtls-compact-names.py"
readonly JDTLS_PATCH_RECIPE="${JDTLS_SCRIPT_DIR}/../tools/jdtls/compact-class-names.json"

usage() {
  printf 'Usage: %s [--verify-only]\n' "${0##*/}"
}

fail() {
  printf 'install-jdtls: %s\n' "$*" >&2
  exit 1
}

launcher_for() {
  local directory="$1"
  local -a launchers=()

  shopt -s nullglob
  launchers=("${directory}"/plugins/org.eclipse.equinox.launcher_*.jar)
  shopt -u nullglob
  ((${#launchers[@]} == 1)) || return 1
  [[ -s "${launchers[0]}" ]] || return 1
  printf '%s\n' "${launchers[0]}"
}

validate_layout() {
  local directory="$1"
  local launcher

  [[ -d "${directory}/plugins" ]] || fail "missing plugins directory in ${directory}"
  [[ -s "${directory}/config_linux/config.ini" ]] || fail "missing Linux launcher configuration in ${directory}"
  launcher="$(launcher_for "${directory}")" || fail "expected exactly one non-empty Equinox launcher in ${directory}/plugins"

  if command -v jar >/dev/null 2>&1; then
    jar tf "${launcher}" >/dev/null || fail "launcher is not a readable JAR: ${launcher}"
  fi
  printf '%s\n' "${launcher}"
}

validate_archive_paths() {
  local archive="$1"
  local entry component

  while IFS= read -r entry; do
    [[ -n "${entry}" ]] || continue
    [[ "${entry}" != /* ]] || fail "archive contains an absolute path: ${entry}"
    IFS='/' read -r -a components <<< "${entry}"
    for component in "${components[@]}"; do
      [[ "${component}" != '..' ]] || fail "archive contains a parent-directory path: ${entry}"
    done
  done < <(tar -tzf "${archive}")
}

verify_install() {
  local directory="$1"
  local launcher relative_launcher manifest

  [[ -d "${directory}" ]] || fail "JDT LS ${JDTLS_VERSION} is not installed at ${directory}"
  launcher="$(validate_layout "${directory}")"
  relative_launcher="${launcher#"${directory}/"}"
  manifest="${directory}/install-manifest.json"
  [[ -s "${manifest}" ]] || fail "missing installation manifest: ${manifest}"
  grep -Fq '"version": "'"${JDTLS_VERSION}"'"' "${manifest}" || fail "manifest version does not match"
  grep -Fq '"minimumRuntimeJava": 25' "${manifest}" || fail "manifest runtime requirement does not match"
  grep -Fq '"sha256": "'"${JDTLS_SHA256}"'"' "${manifest}" || fail "manifest checksum does not match"
  grep -Fq '"sourceUrl": "'"${JDTLS_URL}"'"' "${manifest}" || fail "manifest source URL does not match"
  grep -Fq '"launcher": "'"${relative_launcher}"'"' "${manifest}" || fail "manifest launcher does not match"
  command -v python3 >/dev/null 2>&1 || fail 'required command is unavailable: python3'
  python3 "${JDTLS_PATCH_BUILDER}" --verify-home "${directory}" || fail 'derived compiler verification failed'
  printf 'Verified JDT LS %s (IDE compact-class name correction)\nLauncher: %s\n' "${JDTLS_VERSION}" "${launcher}"
}

verify_only=false
case "${1:-}" in
  '') ;;
  --verify-only) verify_only=true ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; fail "unknown argument: $1" ;;
esac
[[ $# -le 1 ]] || { usage >&2; fail 'too many arguments'; }

if [[ "${verify_only}" == true ]]; then
  [[ -L "${CURRENT_LINK}" ]] || fail "current link is missing: ${CURRENT_LINK}"
  [[ "$(readlink "${CURRENT_LINK}")" == "${JDTLS_VERSION}" ]] || fail "current link does not select ${JDTLS_VERSION}"
  verify_install "${VERSION_DIR}"
  exit 0
fi

for command in curl sha256sum tar patch python3; do
  command -v "${command}" >/dev/null 2>&1 || fail "required command is unavailable: ${command}"
done

mkdir -p "${INSTALL_ROOT}"

if [[ -d "${VERSION_DIR}" ]]; then
  verify_install "${VERSION_DIR}"
else
  work_dir="$(mktemp -d "${INSTALL_ROOT}/.install-${JDTLS_VERSION}.XXXXXX")"
  stage_dir="${work_dir}/stage"
  archive="${work_dir}/${JDTLS_ARTIFACT}"
  checksum_file="${archive}.sha256"
  cleanup() { rm -rf -- "${work_dir}"; }
  trap cleanup EXIT HUP INT TERM

  if [[ -n "${IDE_JDTLS_ARCHIVE_CACHE:-}" ]]; then
    cp -- "${IDE_JDTLS_ARCHIVE_CACHE}" "${archive}"
    acquisition="pinned archive cache"
  else
    curl --fail --location --silent --show-error \
    --proto '=https' --tlsv1.2 --retry 4 --retry-all-errors --retry-delay 2 \
    --connect-timeout 15 --max-time 1800 --continue-at - --output "${archive}" "${JDTLS_URL}"
    curl --fail --location --silent --show-error \
    --proto '=https' --tlsv1.2 --retry 4 --retry-all-errors --retry-delay 2 \
    --connect-timeout 15 --max-time 120 --output "${checksum_file}" "${JDTLS_CHECKSUM_URL}"

    official_sha256="$(grep -Eo '[[:xdigit:]]{64}' "${checksum_file}" | head -n 1 | tr '[:upper:]' '[:lower:]')"
    [[ "${official_sha256}" == "${JDTLS_SHA256}" ]] || fail "official checksum document does not match the pinned checksum"
    acquisition="verified upstream download"
  fi
  printf '%s  %s\n' "${JDTLS_SHA256}" "${archive}" | sha256sum --check --status \
    || fail "artifact checksum verification failed"

  validate_archive_paths "${archive}"
  mkdir "${stage_dir}"
  tar -xzf "${archive}" --no-same-owner --no-same-permissions -C "${stage_dir}"
  if find "${stage_dir}" -type l -print -quit | grep -q .; then
    fail "archive contains a symbolic link; refusing potentially unsafe link targets"
  fi
  launcher="$(validate_layout "${stage_dir}")"
  relative_launcher="${launcher#"${stage_dir}/"}"
  installed_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  cat > "${stage_dir}/install-manifest.json" <<EOF
{
  "version": "${JDTLS_UPSTREAM_VERSION}",
  "minimumRuntimeJava": 25,
  "sourceUrl": "${JDTLS_URL}",
  "checksumUrl": "${JDTLS_CHECKSUM_URL}",
  "sha256": "${JDTLS_SHA256}",
  "installedAt": "${installed_at}",
  "sourceAcquisition": "${acquisition}",
  "launcher": "${relative_launcher}"
}
EOF

  source_file="${work_dir}/TypeDeclaration.java"
  if [[ -n "${IDE_JDTLS_TYPE_DECLARATION_SOURCE_CACHE:-}" ]]; then
    cp -- "${IDE_JDTLS_TYPE_DECLARATION_SOURCE_CACHE}" "${source_file}"
  else
    source_url="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sourceUrl"])' "${JDTLS_PATCH_RECIPE}")"
    curl --fail --location --silent --show-error \
      --proto '=https' --tlsv1.2 --retry 4 --retry-all-errors --retry-delay 2 \
      --connect-timeout 15 --max-time 120 --output "${source_file}" "${source_url}"
  fi
  if [[ -n "${IDE_JDTLS_JAVA_HOME:-}" ]]; then
    build_java="${IDE_JDTLS_JAVA_HOME}/bin/java"
  elif [[ -n "${JAVA_HOME:-}" ]]; then
    build_java="${JAVA_HOME}/bin/java"
  else
    build_java="$(command -v java)" || fail 'a full JDK 17 or later is required to prepare the compiler correction'
  fi
  derived_stage="${work_dir}/derived"
  python3 "${JDTLS_PATCH_BUILDER}" --input-home "${stage_dir}" --output-home "${derived_stage}" \
    --source-file "${source_file}" --java "${build_java}" || fail 'cannot prepare the source-derived compiler correction'

  # The complete staged tree is validated before this same-filesystem atomic rename.
  mv -- "${derived_stage}" "${VERSION_DIR}"
  trap - EXIT HUP INT TERM
  cleanup
fi

link_tmp="${INSTALL_ROOT}/.current.${$}"
rm -f -- "${link_tmp}"
ln -s "${JDTLS_VERSION}" "${link_tmp}"
mv -Tf -- "${link_tmp}" "${CURRENT_LINK}"
verify_install "${VERSION_DIR}"
