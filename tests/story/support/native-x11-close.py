#!/usr/bin/python3
"""Send the standard X11 close request to the unique IDE window for an owned PID.

The caller separately verifies executable, process start time and sandbox ownership.
No JavaScript close-event injection, signal or window-manager utility is substituted.
"""
import ctypes as C
import json
import sys


def main():
    list_only = len(sys.argv) == 2 and sys.argv[1] == "--list"
    if not list_only and (len(sys.argv) != 2 or not sys.argv[1].isdigit() or int(sys.argv[1]) <= 1):
        raise RuntimeError("a valid owned application PID is required")
    pid = None if list_only else int(sys.argv[1])
    x = C.CDLL("libX11.so.6")
    display_type, window_type, atom_type = C.c_void_p, C.c_ulong, C.c_ulong
    x.XOpenDisplay.argtypes = [C.c_char_p]
    x.XOpenDisplay.restype = display_type
    x.XDefaultRootWindow.argtypes = [display_type]
    x.XDefaultRootWindow.restype = window_type
    x.XInternAtom.argtypes = [display_type, C.c_char_p, C.c_int]
    x.XInternAtom.restype = atom_type
    x.XQueryTree.argtypes = [display_type, window_type, C.POINTER(window_type), C.POINTER(window_type), C.POINTER(C.POINTER(window_type)), C.POINTER(C.c_uint)]
    x.XGetWindowProperty.argtypes = [display_type, window_type, atom_type, C.c_long, C.c_long, C.c_int, atom_type, C.POINTER(atom_type), C.POINTER(C.c_int), C.POINTER(C.c_ulong), C.POINTER(C.c_ulong), C.POINTER(C.POINTER(C.c_ubyte))]
    x.XFree.argtypes = [C.c_void_p]
    x.XFetchName.argtypes = [display_type, window_type, C.POINTER(C.c_void_p)]
    x.XCloseDisplay.argtypes = [display_type]
    x.XSync.argtypes = [display_type, C.c_int]
    x.XSendEvent.argtypes = [display_type, window_type, C.c_int, C.c_long, C.c_void_p]
    d = x.XOpenDisplay(None)
    if not d:
        raise RuntimeError("X11 display is unavailable")
    try:
        pid_atom = x.XInternAtom(d, b"_NET_WM_PID", False)
        protocols = x.XInternAtom(d, b"WM_PROTOCOLS", False)
        delete = x.XInternAtom(d, b"WM_DELETE_WINDOW", False)

        def property32(window, atom):
            actual, fmt, count, remaining = atom_type(), C.c_int(), C.c_ulong(), C.c_ulong()
            data = C.POINTER(C.c_ubyte)()
            result = x.XGetWindowProperty(d, window, atom, 0, 1024, False, 0, C.byref(actual), C.byref(fmt), C.byref(count), C.byref(remaining), C.byref(data))
            try:
                if result != 0 or fmt.value != 32 or remaining.value != 0:
                    return []
                values = C.cast(data, C.POINTER(C.c_ulong))
                return [values[i] for i in range(count.value)]
            finally:
                if data:
                    x.XFree(data)

        pending, visited, matching, observed = [x.XDefaultRootWindow(d)], set(), [], []
        while pending:
            window = pending.pop()
            if window in visited:
                continue
            visited.add(window)
            if len(visited) > 10000:
                raise RuntimeError("X11 window discovery exceeded its bound")
            window_pid, window_protocols = property32(window, pid_atom), property32(window, protocols)
            name_pointer = C.c_void_p()
            name = ""
            if x.XFetchName(d, window, C.byref(name_pointer)) and name_pointer:
                name = C.string_at(name_pointer).decode("utf-8", errors="replace")[:128]
                x.XFree(name_pointer)
            if window_pid or name:
                observed.append({"windowId": window, "pid": window_pid, "title": name, "protocols": window_protocols})
            closeable = delete in window_protocols
            if pid is not None and window_pid == [pid] and closeable and name == "IDE":
                matching.append(window)
            root, parent, count = window_type(), window_type(), C.c_uint()
            children = C.POINTER(window_type)()
            if x.XQueryTree(d, window, C.byref(root), C.byref(parent), C.byref(children), C.byref(count)):
                pending.extend(children[i] for i in range(count.value))
            if children:
                x.XFree(children)
        if list_only:
            print(
                json.dumps(
                    [
                        {
                            "windowId": item["windowId"],
                            "pid": item["pid"][0] if len(item["pid"]) == 1 else None,
                            "wmName": item["title"],
                            "closeable": delete in item["protocols"],
                        }
                        for item in observed
                    ]
                )
            )
            return
        if len(matching) != 1:
            raise RuntimeError("the owned PID did not identify exactly one closeable IDE X11 window: " + json.dumps(observed[:20]))

        class Client(C.Structure):
            _fields_ = [("type", C.c_int), ("serial", C.c_ulong), ("send_event", C.c_int), ("display", display_type), ("window", window_type), ("message_type", atom_type), ("format", C.c_int), ("data", C.c_long * 5)]

        class Event(C.Union):
            _fields_ = [("client", Client), ("padding", C.c_long * 24)]

        event = Event()
        event.client.type, event.client.send_event = 33, 1  # ClientMessage, True
        event.client.display, event.client.window = d, matching[0]
        event.client.message_type, event.client.format = protocols, 32
        event.client.data[0], event.client.data[1] = delete, 0  # CurrentTime
        if not x.XSendEvent(d, matching[0], False, 0, C.byref(event)):
            raise RuntimeError("X11 close request was not sent")
        x.XSync(d, False)
        print(json.dumps({"windowId": matching[0], "closeRequested": True}))
    finally:
        x.XCloseDisplay(d)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
