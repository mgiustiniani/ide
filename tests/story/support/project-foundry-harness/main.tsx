import type { ComponentType } from "react";
import React from "react";
import ReactDOM from "react-dom/client";

import type {
  Xcom2ProjectFoundryApplyRequest,
  Xcom2ProjectFoundryApplyResult,
  Xcom2ProjectFoundryDestinationParentSelectionGrant,
  Xcom2ProjectFoundryRenderedPlanResult,
  Xcom2ProjectFoundryRenderRequest,
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
    __storyFoundrySelectDestinationParent: StoryBinding;
    __storyFoundryRenderPreview: StoryBinding;
    __storyFoundryApply?: StoryBinding;
    __storyFoundryRevokeOperation: StoryBinding;
    __storyFoundryRevokeGrants: StoryBinding;
    __storyRecordTauriCall: StoryBinding;
  }
}

interface ProjectFoundryHarnessComposition {
  readonly selectors: {
    selectSourceRepository(): Promise<Xcom2ProjectFoundrySourceSelectionGrant>;
    selectDestinationParent(): Promise<Xcom2ProjectFoundryDestinationParentSelectionGrant>;
  };
  readonly renderer: {
    renderPreview(
      request: Readonly<Xcom2ProjectFoundryRenderRequest>,
    ): Promise<Readonly<Xcom2ProjectFoundryRenderedPlanResult>>;
  };
  apply?(request: Xcom2ProjectFoundryApplyRequest): Promise<Xcom2ProjectFoundryApplyResult>;
  readonly grants: {
    revokeOperation(): Promise<void>;
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
      (await window.__storyFoundrySelectDestinationParent()) as Xcom2ProjectFoundryDestinationParentSelectionGrant,
  },
  renderer: {
    renderPreview: async (request) =>
      (await window.__storyFoundryRenderPreview(
        request,
      )) as Readonly<Xcom2ProjectFoundryRenderedPlanResult>,
  },
  apply: async (request) => {
    if (!window.__storyFoundryApply) {
      throw new Error("Project Foundry Apply is not supplied by this composition");
    }
    return (await window.__storyFoundryApply(request)) as Xcom2ProjectFoundryApplyResult;
  },
  grants: {
    revokeOperation: async () => {
      await window.__storyFoundryRevokeOperation();
    },
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
          gradleImportEnabled: false,
          gradleSettingsConfigured: false,
          activeMavenProfiles: [],
          inactiveMavenProfiles: [],
          capabilities: {
            documentSync: true,
            diagnostics: false,
            completion: false,
            hover: false,
            definition: false,
            references: false,
            documentSymbols: false,
            documentHighlights: false,
            implementation: false,
            workspaceSymbols: false,
            semanticTokens: false,
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

// The cast deliberately presents the corrected renderer composition before App migration.
// A focused Story run must therefore stay RED until App/controller adopts this exact boundary.
const ComposableApp = App as ComponentType<ProjectFoundryComposableAppProps>;
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ComposableApp projectFoundry={composition} />
  </React.StrictMode>,
);
