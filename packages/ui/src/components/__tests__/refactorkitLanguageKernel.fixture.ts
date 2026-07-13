import type { RefactorKitCapabilities, RefactorKitLanguageAdapter } from "@ide/contracts";

const runtime = {
  executionMode: "in-process",
  supportsTimeout: true,
  supportsCancellation: false,
  usesWorkspaceOverlay: false,
  recordsProcessProvenance: false,
  limits: {
    requestTimeoutMillis: 2_000,
    maxInputBytes: 16 * 1024 * 1024,
    maxOutputBytes: null,
    maxProcesses: null,
  },
} as const;

function treeSitterAdapter(languageId: "javascript" | "typescript"): RefactorKitLanguageAdapter {
  return {
    languageId,
    extensions: [languageId === "javascript" ? "js" : "ts"],
    backend: "tree-sitter-jni-0.25.3",
    runtime,
    capabilities: [
      {
        operation: "identifierSearch",
        stability: "stable",
        evidence: "native-ast",
        mutationAuthority: "none",
      },
      {
        operation: "localRename",
        stability: "structural",
        evidence: "lexical",
        mutationAuthority: "proposal-only",
      },
      {
        operation: "outline",
        stability: "stable",
        evidence: "native-ast",
        mutationAuthority: "none",
      },
    ],
  };
}

const javaAdapter: RefactorKitLanguageAdapter = {
  languageId: "java",
  extensions: ["java"],
  backend: "eclipse-jdt-ls-1.42.0",
  runtime: {
    executionMode: "external-process",
    supportsTimeout: false,
    supportsCancellation: true,
    usesWorkspaceOverlay: true,
    recordsProcessProvenance: true,
    limits: {
      requestTimeoutMillis: null,
      maxInputBytes: 4_194_304,
      maxOutputBytes: 8_388_608,
      maxProcesses: 2,
    },
  },
  capabilities: [
    {
      operation: "renameClass",
      stability: "stable",
      evidence: "compiler",
      mutationAuthority: "managed-stable",
    },
    {
      operation: "unsafeInline",
      stability: "refused",
      evidence: "none",
      mutationAuthority: "none",
    },
  ],
};

const typeScriptAdapter: RefactorKitLanguageAdapter = {
  languageId: "typescript",
  extensions: ["ts", "tsx"],
  backend: "tree-sitter-typescript-0.23.2",
  runtime: {
    executionMode: "in-process",
    supportsTimeout: true,
    supportsCancellation: false,
    usesWorkspaceOverlay: false,
    recordsProcessProvenance: false,
    limits: {
      requestTimeoutMillis: 2_500,
      maxInputBytes: null,
      maxOutputBytes: null,
      maxProcesses: null,
    },
  },
  capabilities: [
    {
      operation: "localRename",
      stability: "structural",
      evidence: "lexical",
      mutationAuthority: "proposal-only",
    },
  ],
};

const emptyLuaAdapter: RefactorKitLanguageAdapter = {
  languageId: "lua-embedded",
  extensions: [],
  backend: "host-supplied-lua-adapter",
  runtime: {
    executionMode: "in-process",
    supportsTimeout: false,
    supportsCancellation: false,
    usesWorkspaceOverlay: false,
    recordsProcessProvenance: false,
    limits: {
      requestTimeoutMillis: null,
      maxInputBytes: null,
      maxOutputBytes: null,
      maxProcesses: null,
    },
  },
  capabilities: [],
};

/** Deliberately mixed provider-neutral schema fixture in advertised order. */
export const PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES: RefactorKitCapabilities = {
  api: "refactorkit-language-kernel",
  apiVersion: "1.0-test",
  provider: "test-neutral-provider",
  providerVersion: null,
  javaImportExternalClass: {
    supported: false,
    targetDirectory: false,
    preview: false,
    apply: false,
    rollback: false,
    stability: "experimental",
  },
  languageKernel: {
    available: true,
    schema: {
      schemaVersion: 1,
      adapters: [javaAdapter, typeScriptAdapter, emptyLuaAdapter],
      vocabulary: {
        stability: ["stable", "experimental", "structural", "refused", "not-applicable"],
        evidence: [
          "compiler",
          "language-server",
          "native-ast",
          "structural-parse",
          "lexical",
          "none",
        ],
        mutationAuthority: ["managed-stable", "proposal-only", "none"],
        executionMode: ["in-process", "external-process"],
      },
    },
  },
  safety: {
    previewBeforeApply: false,
    snapshotValidation: true,
    transactionRollback: false,
    workspaceScopedWrites: true,
  },
};

export const BROWSER_LANGUAGE_KERNEL_REASON =
  "Local RefactorKit daemon discovery is unavailable in browser clients.";

export const BROWSER_LANGUAGE_KERNEL_CAPABILITIES: RefactorKitCapabilities = {
  ...PROVIDER_NEUTRAL_LANGUAGE_KERNEL_CAPABILITIES,
  languageKernel: {
    available: false,
    schema: null,
    reason: BROWSER_LANGUAGE_KERNEL_REASON,
  },
  safety: undefined,
};

/** Mirrors the current RefactorKit daemon TreeSitterAdapterDescriptors output. */
export const TREE_SITTER_LANGUAGE_KERNEL_CAPABILITIES: RefactorKitCapabilities = {
  api: "refactorkit",
  apiVersion: "0.2",
  provider: "refactorkit",
  providerVersion: "0.6.0-SNAPSHOT",
  javaImportExternalClass: {
    supported: true,
    targetDirectory: true,
    preview: true,
    apply: true,
    rollback: true,
    stability: "experimental",
  },
  languageKernel: {
    available: true,
    schema: {
      schemaVersion: 1,
      adapters: [treeSitterAdapter("javascript"), treeSitterAdapter("typescript")],
      vocabulary: {
        stability: ["stable", "experimental", "structural", "refused", "not-applicable"],
        evidence: [
          "compiler",
          "language-server",
          "native-ast",
          "structural-parse",
          "lexical",
          "none",
        ],
        mutationAuthority: ["managed-stable", "proposal-only", "none"],
        executionMode: ["in-process", "external-process"],
      },
    },
  },
  safety: {
    previewBeforeApply: true,
    snapshotValidation: true,
    transactionRollback: true,
    workspaceScopedWrites: true,
  },
};
