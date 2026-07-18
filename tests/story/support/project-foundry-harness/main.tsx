import type { ComponentType } from "react";
import React from "react";
import ReactDOM from "react-dom/client";

import type {
  Xcom2ProjectFoundryApplyRequest,
  Xcom2ProjectFoundryApplyResult,
  Xcom2ProjectFoundryDestinationParentSelectionGrant,
  Xcom2ProjectFoundryOperationGrant,
  Xcom2ProjectFoundrySourceObjectEvidence,
  Xcom2ProjectFoundrySourceSelectionGrant,
} from "../../../../packages/contracts/src/domain/xcom2-project-foundry";
import { App } from "../../../../apps/desktop/src/App";
import "../../../../packages/ui/src/styles/globals.css";

type StoryBinding = (...args: unknown[]) => Promise<unknown>;

declare global {
  interface Window {
    __TAURI_INTERNALS__: {
      invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
    };
    __storyFoundrySelectSource: StoryBinding;
    __storyFoundrySelectDestination: StoryBinding;
    __storyFoundryResolveSource: StoryBinding;
    __storyFoundryInspectDestination: StoryBinding;
    __storyFoundryApply: StoryBinding;
    __storyFoundryRevokeGrants: StoryBinding;
    __storyRecordTauriCall: StoryBinding;
  }
}

interface ProjectFoundryHarnessComposition {
  readonly selectors: {
    selectSourceRepository(): Promise<Xcom2ProjectFoundrySourceSelectionGrant>;
    selectDestinationParent(): Promise<{
      readonly destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant;
      readonly operationGrant: Xcom2ProjectFoundryOperationGrant;
    }>;
  };
  readonly source: {
    resolvePinnedObject(
      grant: Xcom2ProjectFoundrySourceSelectionGrant,
    ): Promise<Xcom2ProjectFoundrySourceObjectEvidence>;
  };
  readonly destination: {
    inspectDerivedDestination(
      destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant,
      operationGrant: Xcom2ProjectFoundryOperationGrant,
    ): Promise<"absent">;
  };
  apply(request: Xcom2ProjectFoundryApplyRequest): Promise<Xcom2ProjectFoundryApplyResult>;
  readonly grants: {
    revokeAll(): Promise<void>;
  };
}

interface ProjectFoundryComposableAppProps {
  readonly projectFoundry?: ProjectFoundryHarnessComposition;
}

const composition: ProjectFoundryHarnessComposition = {
  selectors: {
    selectSourceRepository: async () =>
      (await window.__storyFoundrySelectSource()) as Xcom2ProjectFoundrySourceSelectionGrant,
    selectDestinationParent: async () =>
      (await window.__storyFoundrySelectDestination()) as {
        readonly destinationParentGrant: Xcom2ProjectFoundryDestinationParentSelectionGrant;
        readonly operationGrant: Xcom2ProjectFoundryOperationGrant;
      },
  },
  source: {
    resolvePinnedObject: async (grant) =>
      (await window.__storyFoundryResolveSource(grant)) as Xcom2ProjectFoundrySourceObjectEvidence,
  },
  destination: {
    inspectDerivedDestination: async (destinationParentGrant, operationGrant) =>
      (await window.__storyFoundryInspectDestination(
        destinationParentGrant,
        operationGrant,
      )) as "absent",
  },
  apply: async (request) =>
    (await window.__storyFoundryApply(request)) as Xcom2ProjectFoundryApplyResult,
  grants: {
    revokeAll: async () => {
      await window.__storyFoundryRevokeGrants();
    },
  },
};

window.__TAURI_INTERNALS__ = {
  async invoke(command, args) {
    await window.__storyRecordTauriCall(command, args ?? {});
    switch (command) {
      case "ensure_current_workspace":
        return {
          id: "generic-foundry-story",
          name: "generic-foundry-story",
          rootPath: "/workspace",
        };
      case "list_workspaces":
        return {
          currentWorkspaceId: "generic-foundry-story",
          workspaces: [
            { id: "generic-foundry-story", name: "generic-foundry-story", rootPath: "/workspace" },
          ],
        };
      case "list_directory":
        return {
          name: "generic-foundry-story",
          path: "/workspace",
          type: "directory",
          children: [],
        };
      case "get_pi_agent_settings":
        return {
          enabled: false,
          provider: "pi",
          preferredIntegration: "rpc",
          fallbackIntegrations: [],
        };
      case "get_pi_agent_status":
        return {
          provider: "pi",
          enabled: false,
          available: false,
          availability: "not-installed",
          preferredIntegration: "rpc",
          fallbackIntegrations: [],
          checkedAt: "2026-07-18T12:00:00.000Z",
        };
      case "list_pi_agent_commands":
        return { provider: "pi", integration: "rpc", commands: [] };
      case "list_agent_runs":
      case "poll_java_language_service_events":
        return [];
      case "get_pi_agent_session_messages":
        return {
          workspaceId: "generic-foundry-story",
          sessionId: "foundry-story-session",
          provider: "pi",
          integration: "rpc",
          messages: [],
        };
      case "get_java_language_service_status":
      case "stop_java_language_service":
        return {
          available: true,
          lifecycle: command === "stop_java_language_service" ? "stopped" : "ready",
          provider: "jdtls",
          workspaceId: "generic-foundry-story",
          workspaceRoot: "/workspace",
          generation: 1,
          capabilities: {
            documentSync: true,
            diagnostics: false,
            completion: false,
            hover: false,
            definition: false,
            references: false,
            documentSymbols: false,
            workspaceSymbols: false,
            rename: false,
            codeActions: false,
            formatting: false,
            signatureHelp: false,
          },
          checkedAt: "2026-07-18T12:00:00.000Z",
        };
      case "open_java_language_document":
      case "change_java_language_document":
      case "save_java_language_document":
      case "close_java_language_document":
        return undefined;
      case "get_refactorkit_status":
        return { available: false, checkedAt: "2026-07-18T12:00:00.000Z" };
      case "get_refactorkit_capabilities":
        return {
          api: "refactorkit",
          apiVersion: "0.2",
          provider: "refactorkit",
          providerVersion: "unavailable",
          javaImportExternalClass: {
            supported: false,
            targetDirectory: false,
            preview: false,
            apply: false,
            rollback: false,
            stability: "experimental",
          },
          safety: {
            previewBeforeApply: false,
            snapshotValidation: false,
            transactionRollback: false,
            workspaceScopedWrites: false,
          },
        };
      default:
        throw new Error(`Project Foundry harness backend does not implement ${command}`);
    }
  },
};

const root = document.getElementById("root");
if (!root) throw new Error("Project Foundry Story harness root is unavailable");

// The cast keeps the anticipated Apply port isolated to the Story composition.
// Production receives the composition unchanged and owns whether that port is used.
const ComposableApp = App as ComponentType<ProjectFoundryComposableAppProps>;
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ComposableApp projectFoundry={composition} />
  </React.StrictMode>,
);
