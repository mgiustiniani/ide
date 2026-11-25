import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);

test("AppImage stages the selected WebKit installation and refuses a missing network process",
  { skip: process.platform !== "linux" }, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ide-webkit-package-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const script = path.join(root, "scripts/stage-appimage-webkit.mjs");
    await mkdir(path.dirname(script));
    await copyFile(new URL("../../scripts/stage-appimage-webkit.mjs", import.meta.url), script);
    const prefix = path.join(root, "sdk");
    await mkdir(prefix);
    await writeFile(path.join(prefix, "webkit2gtk-4.1.pc"), [
      `prefix=${prefix}`, "libdir=${prefix}/lib/x86_64-linux-gnu", "libexecdir=${prefix}/libexec",
      "Name: WebKitGTK", "Description: Package layout fixture", "Version: 2.54.2",
    ].join("\n") + "\n");
    const files = [
      "libexec/webkit2gtk-4.1/WebKitWebProcess",
      "libexec/webkit2gtk-4.1/WebKitNetworkProcess",
      "libexec/webkit2gtk-4.1/WebKitGPUProcess",
      "lib/x86_64-linux-gnu/webkit2gtk-4.1/injected-bundle/libwebkit2gtkinjectedbundle.so",
    ];
    for (const file of files) {
      const source = path.join(prefix, file);
      await mkdir(path.dirname(source), { recursive: true });
      await writeFile(source, file);
      await chmod(source, 0o755);
    }
    const stage = () => exec(process.execPath, [script], {
      env: { ...process.env, PKG_CONFIG_LIBDIR: prefix, PKG_CONFIG_PATH: "", PKG_CONFIG_SYSROOT_DIR: "" },
    });
    const staged = path.join(root, "apps/desktop/src-tauri/target/appimage-webkit-runtime");
    await stage();
    for (const file of files) assert.equal(await readFile(path.join(staged, file), "utf8"), file);
    const gpu = "libexec/webkit2gtk-4.1/WebKitGPUProcess";
    await rm(path.join(prefix, gpu));
    await stage();
    await assert.rejects(access(path.join(staged, gpu)), { code: "ENOENT" });
    await rm(path.join(prefix, "libexec/webkit2gtk-4.1/WebKitNetworkProcess"));
    await assert.rejects(stage(), /missing WebKitNetworkProcess/);
  });
