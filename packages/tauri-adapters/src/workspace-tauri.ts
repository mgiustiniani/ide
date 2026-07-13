// ---------------------------------------------------------------------------
// @ide/tauri-adapters – TauriWorkspaceAdapter
// ---------------------------------------------------------------------------
// Implements WorkspacePort by invoking Tauri Rust commands:
//   ensure_current_workspace, list_workspaces, switch_workspace
// ---------------------------------------------------------------------------

import { WORKSPACE_MARKER_FOLDER, WORKSPACE_REGISTRY_VERSION } from "@ide/contracts";
import { TauriAdapterError, invokeTauri } from "./errors";
import type { WorkspaceInfo, WorkspaceRegistry } from "@ide/contracts";
import type { WorkspacePort } from "@ide/web-core/ports";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidShape(command: string, message: string, response: unknown): TauriAdapterError {
  return new TauriAdapterError(command, `Invalid ${command} response: ${message}`, response);
}

function requireRecord(command: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidShape(command, "expected object", value);
  }

  return value;
}

function requireString(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw invalidShape(command, `missing string ${field}`, response);
  }

  return value;
}

function optionalString(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw invalidShape(command, `invalid string ${field}`, response);
  }

  return value;
}

function optionalCurrentWorkspaceId(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
): string | null | undefined {
  const value = record.currentWorkspaceId;
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "string") {
    return value;
  }

  throw invalidShape(command, "invalid nullable string currentWorkspaceId", response);
}

function optionalRegistryVersion(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
): typeof WORKSPACE_REGISTRY_VERSION | undefined {
  const value = record.version;
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value !== WORKSPACE_REGISTRY_VERSION) {
    throw invalidShape(
      command,
      `unsupported workspace registry version ${String(value)}`,
      response,
    );
  }

  return WORKSPACE_REGISTRY_VERSION;
}

function optionalMarkerFolder(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
): typeof WORKSPACE_MARKER_FOLDER | undefined {
  const value = record.markerFolder;
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value !== WORKSPACE_MARKER_FOLDER) {
    throw invalidShape(command, `unsupported workspace marker folder ${String(value)}`, response);
  }

  return WORKSPACE_MARKER_FOLDER;
}

function normalizeWorkspaceInfo(command: string, response: unknown): WorkspaceInfo {
  const record = requireRecord(command, response);
  const workspace: WorkspaceInfo = {
    id: requireString(command, response, record, "id"),
    name: requireString(command, response, record, "name"),
    rootPath: requireString(command, response, record, "rootPath"),
  };

  const markerFolder = optionalMarkerFolder(command, response, record);
  const createdAt = optionalString(command, response, record, "createdAt");
  const lastOpenedAt = optionalString(command, response, record, "lastOpenedAt");

  if (markerFolder !== undefined) {
    workspace.markerFolder = markerFolder;
  }
  if (createdAt !== undefined) {
    workspace.createdAt = createdAt;
  }
  if (lastOpenedAt !== undefined) {
    workspace.lastOpenedAt = lastOpenedAt;
  }

  return workspace;
}

// Native root authorization is process-wide, so every adapter instance shares one queue.
let rootActivationQueue: Promise<void> = Promise.resolve();

function enqueueRootActivation<T>(operation: () => Promise<T>): Promise<T> {
  const result = rootActivationQueue.then(operation);
  rootActivationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function normalizeWorkspaceRegistry(command: string, response: unknown): WorkspaceRegistry {
  const record = requireRecord(command, response);
  const workspaces = record.workspaces;
  if (!Array.isArray(workspaces)) {
    throw invalidShape(command, "missing array workspaces", response);
  }

  const registry: WorkspaceRegistry = {
    workspaces: workspaces.map((workspace, index) => {
      try {
        return normalizeWorkspaceInfo(command, workspace);
      } catch (error) {
        if (error instanceof TauriAdapterError) {
          throw invalidShape(command, `invalid workspace workspaces[${index}]`, response);
        }
        throw error;
      }
    }),
  };

  const version = optionalRegistryVersion(command, response, record);
  const currentWorkspaceId = optionalCurrentWorkspaceId(command, response, record);

  if (version !== undefined) {
    registry.version = version;
  }
  if (currentWorkspaceId !== undefined) {
    registry.currentWorkspaceId = currentWorkspaceId;
  }

  return registry;
}

export class TauriWorkspaceAdapter implements WorkspacePort {
  /** Ensure the current workspace marker/registry exist and return workspace metadata. */
  ensureCurrentWorkspace(): Promise<WorkspaceInfo> {
    return enqueueRootActivation(async () => {
      const command = "ensure_current_workspace";
      const response = await invokeTauri<unknown>(command);
      return normalizeWorkspaceInfo(command, response);
    });
  }

  /** List known user workspaces from the Tauri backend registry. */
  async listWorkspaces(): Promise<WorkspaceRegistry> {
    const command = "list_workspaces";
    const response = await invokeTauri<unknown>(command);
    return normalizeWorkspaceRegistry(command, response);
  }

  /**
   * Switch the active workspace by id and return workspace metadata.
   *
   * Ensure and switch both mutate one process-wide authorization root. Queue every instance on the
   * same authority boundary so a slow, superseded transition cannot leave the stale root active.
   */
  switchWorkspace(workspaceId: string): Promise<WorkspaceInfo> {
    return enqueueRootActivation(async () => {
      const command = "switch_workspace";
      const response = await invokeTauri<unknown>(command, { workspaceId });
      return normalizeWorkspaceInfo(command, response);
    });
  }
}
