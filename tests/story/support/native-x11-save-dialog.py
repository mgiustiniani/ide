#!/usr/bin/python3
"""Use real X11 keys in the owned export chooser on an isolated Story display."""
import ctypes as C
import json
import os
from pathlib import Path
import sys
import time

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gdk

TITLE = "Export HTTP collections (plain text)"


def main():
    global TITLE
    kind = sys.argv[4] if len(sys.argv) > 4 else "http"
    if kind not in ("http", "sql"):
        raise RuntimeError("unknown export chooser")
    TITLE = "Export captured SQL result (plain text)" if kind == "sql" else "Export HTTP collections (plain text)"
    pid, destination, replace_existing = int(sys.argv[1]), sys.argv[2], sys.argv[3] == "replace"
    sandbox = os.environ.get("IDE_STORY_NATIVE_GUI_SANDBOX_PATH")
    if not sandbox or not os.environ.get("DISPLAY") or pid <= 1:
        raise RuntimeError("an owned native Story display and application are required")
    marker = ("IDE_STORY_NATIVE_GUI_SANDBOX_PATH=" + sandbox).encode()
    if marker not in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0"):
        raise RuntimeError("application no longer belongs to this native Story sandbox")
    if destination != "--cancel":
        path = Path(destination)
        if not path.is_absolute() or not path.is_relative_to(Path(sandbox)) or len(destination.encode()) > 4096:
            raise RuntimeError("test export destination must stay within the owned sandbox")

    Gtk.init([])
    x = C.CDLL("libX11.so.6")
    xt = C.CDLL("libXtst.so.6")
    display_type, window_type, atom_type = C.c_void_p, C.c_ulong, C.c_ulong
    x.XOpenDisplay.argtypes = [C.c_char_p]
    x.XOpenDisplay.restype = display_type
    x.XDefaultRootWindow.argtypes = [display_type]
    x.XDefaultRootWindow.restype = window_type
    x.XInternAtom.argtypes = [display_type, C.c_char_p, C.c_int]
    x.XInternAtom.restype = atom_type
    x.XQueryTree.argtypes = [display_type, window_type, C.POINTER(window_type), C.POINTER(window_type), C.POINTER(C.POINTER(window_type)), C.POINTER(C.c_uint)]
    class WindowAttributes(C.Structure):
        _fields_ = [("x", C.c_int), ("y", C.c_int), ("width", C.c_int), ("height", C.c_int),
                    ("border_width", C.c_int), ("depth", C.c_int), ("visual", C.c_void_p),
                    ("root", window_type), ("window_class", C.c_int), ("bit_gravity", C.c_int),
                    ("win_gravity", C.c_int), ("backing_store", C.c_int), ("backing_planes", C.c_ulong),
                    ("backing_pixel", C.c_ulong), ("save_under", C.c_int), ("colormap", C.c_ulong),
                    ("map_installed", C.c_int), ("map_state", C.c_int), ("all_event_masks", C.c_long),
                    ("your_event_mask", C.c_long), ("do_not_propagate_mask", C.c_long),
                    ("override_redirect", C.c_int), ("screen", C.c_void_p)]
    x.XGetWindowAttributes.argtypes = [display_type, window_type, C.POINTER(WindowAttributes)]
    x.XGetWindowProperty.argtypes = [display_type, window_type, atom_type, C.c_long, C.c_long, C.c_int, atom_type, C.POINTER(atom_type), C.POINTER(C.c_int), C.POINTER(C.c_ulong), C.POINTER(C.c_ulong), C.POINTER(C.POINTER(C.c_ubyte))]
    x.XFetchName.argtypes = [display_type, window_type, C.POINTER(C.c_void_p)]
    x.XGetTransientForHint.argtypes = [display_type, window_type, C.POINTER(window_type)]
    x.XFree.argtypes = [C.c_void_p]
    x.XCloseDisplay.argtypes = [display_type]
    x.XRaiseWindow.argtypes = [display_type, window_type]
    x.XSetInputFocus.argtypes = [display_type, window_type, C.c_int, C.c_ulong]
    x.XSync.argtypes = [display_type, C.c_int]
    x.XGetInputFocus.argtypes = [display_type, C.POINTER(window_type), C.POINTER(C.c_int)]
    error_callback_type = C.CFUNCTYPE(C.c_int, display_type, C.c_void_p)
    # A window can disappear between the tree query and a property lookup.
    error_callback = error_callback_type(lambda *_: 0)
    x.XSetErrorHandler.argtypes = [error_callback_type]
    x.XSetErrorHandler(error_callback)
    x.XStringToKeysym.argtypes = [C.c_char_p]
    x.XStringToKeysym.restype = C.c_ulong
    x.XKeysymToKeycode.argtypes = [display_type, C.c_ulong]
    x.XKeysymToKeycode.restype = C.c_ubyte
    xt.XTestFakeKeyEvent.argtypes = [display_type, C.c_uint, C.c_int, C.c_ulong]
    display = x.XOpenDisplay(None)
    if not display:
        raise RuntimeError("X11 display is unavailable")
    clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
    try:
        pid_atom = x.XInternAtom(display, b"_NET_WM_PID", False)

        def pump(seconds):
            until = time.monotonic() + seconds
            while time.monotonic() < until:
                while Gtk.events_pending():
                    Gtk.main_iteration_do(False)
                time.sleep(0.01)

        def windows():
            pending, visited, found = [x.XDefaultRootWindow(display)], set(), []
            while pending:
                window = pending.pop()
                if window in visited:
                    continue
                visited.add(window)
                if len(visited) > 10000:
                    raise RuntimeError("X11 window discovery exceeded its bound")
                actual, fmt, count, remaining = atom_type(), C.c_int(), C.c_ulong(), C.c_ulong()
                data = C.POINTER(C.c_ubyte)()
                result = x.XGetWindowProperty(display, window, pid_atom, 0, 1, False, 0, C.byref(actual), C.byref(fmt), C.byref(count), C.byref(remaining), C.byref(data))
                try:
                    owned = result == 0 and fmt.value == 32 and count.value == 1 and C.cast(data, C.POINTER(C.c_ulong))[0] == pid
                finally:
                    if data:
                        x.XFree(data)
                attributes = WindowAttributes()
                visible = x.XGetWindowAttributes(display, window, C.byref(attributes)) and attributes.map_state == 2
                if owned and visible:
                    pointer = C.c_void_p()
                    name = ""
                    if x.XFetchName(display, window, C.byref(pointer)) and pointer:
                        name = C.string_at(pointer).decode("utf-8", errors="replace")[:128]
                        x.XFree(pointer)
                    parent = window_type()
                    x.XGetTransientForHint(display, window, C.byref(parent))
                    found.append((window, name, parent.value))
                root, parent, children, length = window_type(), window_type(), C.POINTER(window_type)(), C.c_uint()
                if x.XQueryTree(display, window, C.byref(root), C.byref(parent), C.byref(children), C.byref(length)):
                    try:
                        pending.extend(children[i] for i in range(length.value))
                    finally:
                        if children:
                            x.XFree(children)
            return found

        until = time.monotonic() + 8
        dialog = None
        while time.monotonic() < until:
            candidates = [value for value in windows() if value[1] == TITLE]
            if len(candidates) > 1:
                raise RuntimeError("multiple owned export dialogs are present")
            if candidates:
                dialog = candidates[0][0]
                break
            pump(0.05)
        if dialog is None:
            root = Gdk.get_default_root_window()
            if root:
                pixels = Gdk.pixbuf_get_from_window(root, 0, 0, root.get_width(), root.get_height())
                if pixels:
                    pixels.savev(str(Path(sandbox) / "artifacts/native-http-export-chooser-failure.png"), "png", [], [])
            raise RuntimeError("the owned HTTP export save dialog was not shown; owned windows: " + repr(windows()))

        def keys(window, names):
            if not any(value[0] == window for value in windows()):
                raise RuntimeError("native dialog disappeared before keyboard input")
            x.XRaiseWindow(display, window)
            x.XSetInputFocus(display, window, 1, 0)
            x.XSync(display, False)
            focus, revert = window_type(), C.c_int()
            x.XGetInputFocus(display, C.byref(focus), C.byref(revert))
            if focus.value != window:
                raise RuntimeError("the owned native dialog did not receive focus")
            codes = [x.XKeysymToKeycode(display, x.XStringToKeysym(name.encode())) for name in names]
            if not all(codes):
                raise RuntimeError("native dialog key mapping is unavailable")
            for code in codes:
                xt.XTestFakeKeyEvent(display, code, True, 0)
            for code in reversed(codes):
                xt.XTestFakeKeyEvent(display, code, False, 0)
            x.XSync(display, False)
            pump(0.15)

        confirmed = False
        if destination == "--cancel":
            keys(dialog, ["Escape"])
        else:
            clipboard.set_text(destination, -1)
            Gdk.flush()
            keys(dialog, ["Control_L", "l"])
            keys(dialog, ["Control_L", "a"])
            keys(dialog, ["Control_L", "v"])
            keys(dialog, ["Return"])
            if any(value[0] == dialog for value in windows()):
                keys(dialog, ["Alt_L", "s"])

        until = time.monotonic() + 6
        while time.monotonic() < until:
            current = windows()
            if not any(value[0] == dialog for value in current):
                print(json.dumps({"ownerPid": pid, "title": TITLE, "cancelled": destination == "--cancel", "replaceConfirmed": confirmed}))
                return
            confirmations = [value for value in current if value[2] == dialog and value[0] != dialog]
            if replace_existing and confirmations and not confirmed:
                if len(confirmations) != 1:
                    raise RuntimeError("native overwrite confirmation is ambiguous")
                keys(confirmations[0][0], ["Alt_L", "r"])
                confirmed = True
            pump(0.05)
        root = Gdk.get_default_root_window()
        if root:
            pixels = Gdk.pixbuf_get_from_window(root, 0, 0, root.get_width(), root.get_height())
            if pixels:
                pixels.savev(str(Path(sandbox) / "artifacts/native-http-export-chooser-failure.png"), "png", [], [])
        raise RuntimeError("native save dialog did not close after the explicit keyboard action; visible owned windows: " + repr(windows()))
    finally:
        clipboard.clear()
        Gdk.flush()
        x.XCloseDisplay(display)


if __name__ == "__main__":
    main()
