#!/usr/bin/env bash
set -eu

: "${IDE_STORY_NATIVE_GUI_KWIN_WAYLAND_PATH:?KWin is required}"
: "${IDE_STORY_NATIVE_GUI_ARTIFACT_PATH:?Native Story artifacts directory is required}"
: "${DBUS_SESSION_BUS_ADDRESS:?An isolated D-Bus session is required}"

runtime=$(mktemp -d /tmp/ide-story-wayland.XXXXXX)
compositor_pid=
cleanup() {
  if [[ -n "$compositor_pid" ]]; then
    kill "$compositor_pid" 2>/dev/null || true
    wait "$compositor_pid" 2>/dev/null || true
  fi
  rm -rf -- "$runtime"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

unset DISPLAY GDK_BACKEND WAYLAND_DISPLAY WAYLAND_SOCKET
export XDG_SESSION_TYPE=wayland LIBGL_ALWAYS_SOFTWARE=1
export IDE_STORY_NATIVE_GUI_DISPLAY_BACKEND=wayland
XDG_RUNTIME_DIR="$runtime" "$IDE_STORY_NATIVE_GUI_KWIN_WAYLAND_PATH" \
  --virtual --no-lockscreen --no-global-shortcuts --no-kactivities \
  --width "$IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_WIDTH" \
  --height "$IDE_STORY_NATIVE_GUI_DESIRED_WEBVIEW_HEIGHT" \
  --socket ide-story >"$IDE_STORY_NATIVE_GUI_ARTIFACT_PATH/kwin-wayland.log" 2>&1 &
compositor_pid=$!
export WAYLAND_DISPLAY="$runtime/ide-story"

for ((attempt=0; attempt<100; attempt++)); do
  [[ -S "$WAYLAND_DISPLAY" ]] && break
  if ! kill -0 "$compositor_pid" 2>/dev/null; then
    echo 'KWin exited before creating its Wayland socket.' >&2
    exit 1
  fi
  sleep 0.1
done
if [[ ! -S "$WAYLAND_DISPLAY" ]]; then
  echo 'KWin did not create its Wayland socket within 10 seconds.' >&2
  exit 1
fi

"$@"
