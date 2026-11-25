import { open } from "@tauri-apps/plugin-dialog";
import type { JavaProjectPathPickerPort } from "@ide/web-core";
import { invokeTauri, TauriAdapterError } from "./errors";

const DIALOG_COMMAND = "plugin:dialog|open";
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/u;

function normalizeSelection(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4096 ||
    value.includes("\0") ||
    !ABSOLUTE_PATH.test(value)
  )
    throw new TauriAdapterError(DIALOG_COMMAND, "The selected Java project path is invalid.");
  return value;
}

async function select(options: {
  directory: boolean;
  defaultPath?: string;
}): Promise<string | null> {
  if (
    options.defaultPath !== undefined &&
    (options.defaultPath.length === 0 ||
      options.defaultPath.length > 4096 ||
      options.defaultPath.includes("\0") ||
      !ABSOLUTE_PATH.test(options.defaultPath))
  )
    throw new TauriAdapterError(DIALOG_COMMAND, "The Java project path is invalid.");
  try {
    return normalizeSelection(await open({ ...options, multiple: false }));
  } catch (error) {
    if (error instanceof TauriAdapterError) throw error;
    throw new TauriAdapterError(DIALOG_COMMAND, "The Java project path dialog failed.", error);
  }
}

/** Native path selection for Java project and tool settings. */
export class TauriJavaProjectPathPickerAdapter implements JavaProjectPathPickerPort {
  async listFormatterProfiles(workspaceId: string, path: string): Promise<string[]> {
    const command = "list_java_formatter_profiles";
    const names = await invokeTauri<unknown>(command, { workspaceId, path });
    if (!Array.isArray(names) || !names.length || names.some((name) => typeof name !== "string" || !name.trim()))
      throw new TauriAdapterError(command, "The formatter profile list is invalid.");
    return names;
  }

  selectDirectory(defaultPath?: string): Promise<string | null> {
    return select({ directory: true, ...(defaultPath === undefined ? {} : { defaultPath }) });
  }

  selectFile(): Promise<string | null> {
    return select({ directory: false });
  }

  async selectWorkspaceXmlFile(workspaceRoot: string): Promise<string | null> {
    if (
      workspaceRoot.length === 0 ||
      workspaceRoot.length > 4096 ||
      workspaceRoot.includes("\0") ||
      !ABSOLUTE_PATH.test(workspaceRoot)
    ) {
      throw new TauriAdapterError(DIALOG_COMMAND, "The workspace path is invalid.");
    }
    let selection: string | null;
    try {
      selection = normalizeSelection(
        await open({
          directory: false,
          defaultPath: workspaceRoot,
          multiple: false,
          filters: [{ name: "Eclipse formatter profile", extensions: ["xml"] }],
        }),
      );
    } catch (error) {
      if (error instanceof TauriAdapterError) throw error;
      throw new TauriAdapterError(DIALOG_COMMAND, "The formatter profile dialog failed.", error);
    }
    if (selection === null) return null;

    const root = workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "");
    const path = selection.replace(/\\/g, "/");
    const insensitive = /^[A-Za-z]:\//.test(root) || root.startsWith("//");
    const candidateRoot = insensitive ? root.toLowerCase() : root;
    const candidatePath = insensitive ? path.toLowerCase() : path;
    const prefix = `${candidateRoot}/`;
    if (!candidatePath.startsWith(prefix) || !path.toLowerCase().endsWith(".xml")) {
      throw new TauriAdapterError(
        DIALOG_COMMAND,
        "Choose an XML formatter profile inside the active workspace.",
      );
    }
    const relativePath = path.slice(root.length + 1);
    if (
      relativePath.length === 0 ||
      relativePath
        .replace(/\\/g, "/")
        .split("/")
        .some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new TauriAdapterError(
        DIALOG_COMMAND,
        "The selected formatter profile path is invalid.",
      );
    }
    return relativePath;
  }
}
