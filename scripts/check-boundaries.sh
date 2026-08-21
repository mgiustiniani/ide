#!/usr/bin/env bash
set -euo pipefail

echo "=== Checking package boundaries ==="

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Verify packages only depend on allowed dependencies
check_package() {
  local name="$1"
  local allowed="$2"
  local pkg="$ROOT/packages/$name/package.json"

  if [ ! -f "$pkg" ]; then
    echo "  SKIP $name (no package.json)"
    return
  fi

  local deps
  deps=$(jq -r '.dependencies // {} | keys[]' "$pkg" 2>/dev/null || true)

  for dep in $deps; do
    # workspace:* deps are internal
    local scope
    scope=$(echo "$dep" | cut -d'/' -f1)
    local pkg_name
    pkg_name=$(echo "$dep" | cut -d'/' -f2-)

    if [ "$scope" != "@ide" ]; then
      # External dependency - allowed
      continue
    fi

    if [[ "$allowed" != *"$pkg_name"* ]]; then
      echo "  ERROR: $name depends on @ide/$pkg_name but only allowed: $allowed"
      exit 1
    fi
  done

  echo "  OK   $name"
}

check_package "contracts" ""
check_package "web-core" "contracts"
check_package "ui" "contracts web-core"
check_package "browser-adapters" "contracts web-core"
# Runtime adapters implement the port interfaces exported by web-core.
check_package "tauri-adapters" "contracts web-core"

echo ""
echo "=== Checking web/native import boundaries ==="
web_source_roots=(
  "$ROOT/packages/ui/src"
  "$ROOT/packages/web-core/src"
  "$ROOT/apps/web/src"
)

if rg -n '@tauri-apps/api' "${web_source_roots[@]}"; then
  echo "  ERROR: reusable UI/web code must not import @tauri-apps/api"
  exit 1
fi

echo "  OK   packages/ui, packages/web-core, apps/web"

echo ""
echo "=== Boundaries OK ==="
