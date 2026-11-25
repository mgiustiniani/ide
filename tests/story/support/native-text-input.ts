import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { NativeDesktopApplication } from "./native-desktop-application.js";
import { bounded } from "./native-desktop-application.js";

const CLIPBOARD_OWNER = `import signal, sys
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, Gdk, GLib
value = sys.stdin.read()
Gtk.init([])
clipboard = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
clipboard.set_text(value, -1)
Gdk.flush()
signal.signal(signal.SIGTERM, lambda *_: GLib.idle_add(Gtk.main_quit))
def announce_ready():
    print('READY', flush=True)
    return GLib.SOURCE_REMOVE
GLib.idle_add(announce_ready)
try:
    Gtk.main()
finally:
    clipboard.clear()
    Gdk.flush()
`;

function nativeClipboardBackend() {
  assert.ok(process.env.IDE_STORY_NATIVE_GUI_SANDBOX_PATH, "clipboard input requires an isolated native Story display");
  if (process.env.IDE_STORY_NATIVE_GUI_DISPLAY_BACKEND === "wayland") {
    assert.ok(!process.env.DISPLAY && /^\/tmp\/ide-story-wayland\.[^/]+\/ide-story$/.test(process.env.WAYLAND_DISPLAY ?? ""),
      "clipboard input requires the runner's private Wayland socket");
    return "wayland";
  }
  assert.ok(process.env.DISPLAY, "clipboard input requires an isolated X11 display");
  return "x11";
}

async function readWaylandClipboard(timeout = 5000) {
  const executable = process.env.IDE_STORY_NATIVE_GUI_WL_PASTE_PATH;
  assert.ok(executable && path.isAbsolute(executable), "the native Wayland Story requires wl-paste");
  const { stdout } = await promisify(execFile)(executable, ["--no-newline", "--type", "text"], {
    timeout,
    maxBuffer: 8192,
  });
  return stdout;
}

/** Compare complete small editor text through real Ctrl+A/C, including virtualized lines. */
export async function readNativeCopiedText(application: Pick<NativeDesktopApplication, "browser">): Promise<string> {
  assert.ok(process.env.IDE_STORY_NATIVE_GUI_SANDBOX_PATH && process.env.DISPLAY);
  await application.browser().keys(["Control", "a"]);
  await application.browser().keys(["Control", "c"]);
  const { stdout } = await promisify(execFile)(
    "/usr/bin/python3",
    [
      "-c",
      "import gi; gi.require_version('Gtk','3.0'); from gi.repository import Gtk, Gdk; value=Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text(); print(value if value is not None else '',end='')",
    ],
    { env: { ...process.env, GDK_BACKEND: "x11" }, timeout: 5000, maxBuffer: 8192 },
  );
  await application.browser().keys(["Control", "Home"]);
  return stdout;
}

export async function assertNativeCopiedText(
  application: Pick<NativeDesktopApplication, "browser">,
  expected: string,
) {
  assert.ok(Buffer.byteLength(expected) <= 4096, "native copied text must be bounded");
  const stdout = await readNativeCopiedText(application);
  assert.ok(
    stdout === expected,
    `Native copied text mismatch: ${Buffer.byteLength(stdout)} observed bytes, ${Buffer.byteLength(expected)} expected bytes.`,
  );
}

/** Paste into a visible form control or editor through the isolated native display. */
export async function pasteNativeText(
  application: Pick<NativeDesktopApplication, "browser">,
  input: ReturnType<ReturnType<NativeDesktopApplication["browser"]>["$"]>,
  value: string,
  options: { focus?(): Promise<void>; verify?(): Promise<boolean> } = {},
) {
  const backend = nativeClipboardBackend();
  assert.ok(Buffer.byteLength(value) <= 4096, "native form input must be bounded");
  const waylandWriter = process.env.IDE_STORY_NATIVE_GUI_WL_COPY_PATH;
  if (backend === "wayland") {
    assert.ok(waylandWriter && path.isAbsolute(waylandWriter), "the native Wayland Story requires wl-copy");
  }
  const child = spawn(backend === "wayland" ? waylandWriter! : "/usr/bin/python3", backend === "wayland"
    ? ["--foreground", "--type", "text/plain;charset=utf-8"]
    : ["-c", CLIPBOARD_OWNER], {
    env: backend === "wayland" ? process.env : { ...process.env, GDK_BACKEND: "x11" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      readyReject(new Error("Native clipboard owner exited before input."));
      resolve();
    });
    child.once("error", (error) => {
      readyReject(error);
      resolve();
    });
  });
  child.stdout.once("data", (data: Buffer) => {
    if (data.toString().trim() === "READY") readyResolve();
    else readyReject(new Error("Native clipboard ownership was not acknowledged."));
  });
  child.stderr.on("data", () => {
    /* Do not print unrelated GTK startup diagnostics. */
  });
  child.stdin.once("error", readyReject);
  try {
    child.stdin.end(value, "utf8");
    if (backend === "wayland") {
      await Promise.race([ready, application.browser().waitUntil(
        async () => (await readWaylandClipboard(500).catch(() => null)) === value,
        { timeout: 3000, interval: 50, timeoutMsg: "Wayland clipboard ownership was not acknowledged." },
      )]);
    } else {
      await bounded(ready, 3000, "native clipboard ownership");
    }
    await input.scrollIntoView();
    const verify = options.verify ?? (async () => (await input.getValue()) === value);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (options.focus) await options.focus();
      else await input.click();
      await application.browser().keys(["Control", "a"]);
      await application.browser().keys(["Control", "v"]);
      try {
        await application.browser().waitUntil(verify, {
          timeout: 1000,
          interval: 50,
          timeoutMsg: "Native form paste did not preserve its exact value.",
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error("Native form paste did not preserve its exact value.", { cause: lastError });
  } finally {
    child.kill("SIGTERM");
    try {
      await bounded(exited, 2000, "native clipboard owner exit");
    } catch {
      child.kill("SIGKILL");
      await bounded(exited, 2000, "native clipboard owner forced exit");
    }
  }
}
