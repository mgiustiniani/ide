#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <provider-repository> <commit> <detached-worktree> <create-new-attestation.json> [java-home]" >&2
  exit 64
}

[[ $# -ge 4 && $# -le 5 ]] || usage
repository=$(realpath "$1")
commit=$2
worktree=$3
attestation=$4
java_home=${5:-/usr/lib/jvm/java-21-openjdk}

[[ ! -e "$worktree" ]] || { echo "detached worktree already exists: $worktree" >&2; exit 65; }
[[ ! -e "$attestation" ]] || { echo "attestation already exists: $attestation" >&2; exit 66; }
java_home=$(realpath "$java_home")
[[ -x "$java_home/bin/java" && -x "$java_home/bin/javac" ]] || {
  echo "JAVA_HOME does not provide java and javac: $java_home" >&2
  exit 69
}
java_version=$($java_home/bin/java -version 2>&1)
javac_version=$($java_home/bin/javac -version 2>&1)
[[ $java_version == *'version "21.'* || $java_version == *'version "21"'* ]] || {
  echo "JDK 21 is required; observed: $java_version" >&2
  exit 69
}

resolved_commit=$(git -C "$repository" rev-parse --verify "${commit}^{commit}")
mkdir -p "$(dirname "$worktree")" "$(dirname "$attestation")"
git -C "$repository" worktree add --detach "$worktree" "$resolved_commit"
worktree=$(realpath "$worktree")

head=$(git -C "$worktree" rev-parse HEAD)
tree=$(git -C "$worktree" rev-parse 'HEAD^{tree}')
[[ $head == "$resolved_commit" ]] || { echo "detached worktree HEAD mismatch" >&2; exit 70; }
[[ $(git -C "$worktree" symbolic-ref -q HEAD || true) == "" ]] || {
  echo "source worktree must be detached" >&2
  exit 70
}
status_before=$(git -C "$worktree" status --porcelain=v1 --untracked-files=all)
[[ -z $status_before ]] || { printf 'source worktree is dirty before build:\n%s\n' "$status_before" >&2; exit 70; }

build_log="${attestation%.json}.build.log"
[[ ! -e "$build_log" ]] || { echo "build log already exists: $build_log" >&2; exit 66; }
build_started=$(date +%s)
build_command_json='["./gradlew","--no-daemon","clean",":modules:refactorkit-daemon:installDist"]'
(
  cd "$worktree"
  JAVA_HOME="$java_home" PATH="$java_home/bin:$PATH" \
    ./gradlew --no-daemon clean :modules:refactorkit-daemon:installDist
) 2>&1 | tee "$build_log"
build_finished=$(date +%s)

status_after=$(git -C "$worktree" status --porcelain=v1 --untracked-files=all)
[[ -z $status_after ]] || { printf 'source worktree is dirty after build:\n%s\n' "$status_after" >&2; exit 70; }
[[ $(git -C "$worktree" rev-parse HEAD) == "$resolved_commit" ]] || {
  echo "source HEAD changed during build" >&2
  exit 70
}
[[ $(git -C "$worktree" rev-parse 'HEAD^{tree}') == "$tree" ]] || {
  echo "source tree changed during build" >&2
  exit 70
}

daemon="$worktree/modules/refactorkit-daemon/build/install/refactorkit-daemon/bin/refactorkit-daemon"
[[ -f "$daemon" && -x "$daemon" ]] || { echo "built daemon launcher missing: $daemon" >&2; exit 71; }
daemon=$(realpath "$daemon")
daemon_sha=$(sha256sum "$daemon" | awk '{print $1}')
build_log=$(realpath "$build_log")
build_log_sha=$(sha256sum "$build_log" | awk '{print $1}')
gradle_version=$(cd "$worktree" && JAVA_HOME="$java_home" PATH="$java_home/bin:$PATH" ./gradlew --version | awk '/^Gradle / {print $2; exit}')
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

tmp=$(mktemp "$(dirname "$attestation")/.build-attestation.XXXXXX")
trap 'rm -f "$tmp"' EXIT
jq -n \
  --arg schemaVersion "refactorkit-daemon-build-attestation-v1" \
  --arg sourceRoot "$worktree" \
  --arg sourceGitHead "$head" \
  --arg sourceGitTree "$tree" \
  --argjson sourceGitDetached true \
  --argjson sourceGitCleanBefore true \
  --argjson sourceGitCleanAfter true \
  --argjson buildCommand "$build_command_json" \
  --arg javaHome "$java_home" \
  --argjson jdkMajor 21 \
  --arg javaVersion "$java_version" \
  --arg javacVersion "$javac_version" \
  --arg gradleVersion "$gradle_version" \
  --arg buildLogPath "$build_log" \
  --arg buildLogSha256 "$build_log_sha" \
  --arg daemonPath "$daemon" \
  --arg daemonSha256 "$daemon_sha" \
  --argjson buildStartedEpochSeconds "$build_started" \
  --argjson buildFinishedEpochSeconds "$build_finished" \
  --arg createdAtUtc "$created_at" \
  '{schemaVersion:$schemaVersion,sourceRoot:$sourceRoot,sourceGitHead:$sourceGitHead,sourceGitTree:$sourceGitTree,sourceGitDetached:$sourceGitDetached,sourceGitCleanBefore:$sourceGitCleanBefore,sourceGitCleanAfter:$sourceGitCleanAfter,buildCommand:$buildCommand,javaHome:$javaHome,jdkMajor:$jdkMajor,javaVersion:$javaVersion,javacVersion:$javacVersion,gradleVersion:$gradleVersion,buildLogPath:$buildLogPath,buildLogSha256:$buildLogSha256,daemonPath:$daemonPath,daemonSha256:$daemonSha256,buildStartedEpochSeconds:$buildStartedEpochSeconds,buildFinishedEpochSeconds:$buildFinishedEpochSeconds,createdAtUtc:$createdAtUtc}' \
  > "$tmp"
chmod 0444 "$tmp"
ln "$tmp" "$attestation"
rm "$tmp"
trap - EXIT
printf 'attestation=%s\nattestationSha256=%s\ndaemon=%s\ndaemonSha256=%s\nsourceHead=%s\nsourceTree=%s\n' \
  "$(realpath "$attestation")" "$(sha256sum "$attestation" | awk '{print $1}')" "$daemon" "$daemon_sha" "$head" "$tree"
