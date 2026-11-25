import { execFileSync } from "node:child_process";
import { constants, accessSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// WebKit starts separate processes relative to its packaged library layout.
// The native linker can resolve a non-system SDK even when Tauri's bundler
// cannot discover the corresponding helper executables in system directories.
const variable = (name) => execFileSync("pkg-config", [
  `--variable=${name}`, "webkit2gtk-4.1",
], { encoding: "utf8" }).trim();
const prefix = variable("prefix");
const libdir = variable("libdir");
if (!path.isAbsolute(prefix) || !path.isAbsolute(libdir))
  throw new Error("WebKitGTK 4.1 must report an absolute installation prefix and library directory.");
const directories = new Set([libdir, variable("libexecdir"),
  ...["libexec", "lib64", "lib"].map((dir) => path.join(prefix, dir)),
].filter((dir) => path.isAbsolute(dir)));
const stage = fileURLToPath(new URL("../apps/desktop/src-tauri/target/appimage-webkit-runtime/", import.meta.url));
const files = [];
for (const name of ["WebKitNetworkProcess", "WebKitWebProcess", "injected-bundle/libwebkit2gtkinjectedbundle.so", "WebKitGPUProcess"]) {
  let found = false;
  for (const directory of directories) {
    const source = path.join(directory, "webkit2gtk-4.1", name);
    try {
      accessSync(source, name.endsWith(".so") ? constants.R_OK : constants.X_OK);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const relative = path.relative(prefix, directory);
    const layout = relative === ".." || relative.startsWith(`..${path.sep}`)
      ? path.relative(path.parse(directory).root, directory)
      : relative;
    files.push({ source, destination: path.join(stage, layout, "webkit2gtk-4.1", name) });
    found = true;
    break;
  }
  if (!found && name !== "WebKitGPUProcess")
    throw new Error(`The selected WebKitGTK 4.1 installation is missing ${name}.`);
}
rmSync(stage, { recursive: true, force: true });
for (const { source, destination } of files) {
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}
