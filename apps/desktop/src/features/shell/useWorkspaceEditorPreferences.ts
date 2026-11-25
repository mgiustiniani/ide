import {
  DEFAULT_WORKSPACE_EDITOR_PREFERENCES,
  type WorkspaceEditorPreferences,
} from "@ide/contracts";
import { useCallback, useMemo, useState } from "react";

const STORAGE_PREFIX = "ide.workspace.editor-preferences.v1.";

type PreferenceSnapshot = {
  preferences: WorkspaceEditorPreferences;
  error: string | null;
};

function storageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(workspaceId)}`;
}

function validPreferences(value: unknown): value is WorkspaceEditorPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const profile = candidate.javaFormatterProfile;
  const profilePath =
    typeof profile === "object" && profile !== null && !Array.isArray(profile)
      ? (profile as Record<string, unknown>).path
      : undefined;
  const validProfile =
    profile === undefined ||
    (typeof profile === "object" &&
      profile !== null &&
      !Array.isArray(profile) &&
      typeof profilePath === "string" &&
      profilePath.length > 0 &&
      profilePath.length <= 4096 &&
      profilePath.trim() === profilePath &&
      profilePath.toLowerCase().endsWith(".xml") &&
      !profilePath.startsWith("/") &&
      !/^[A-Za-z]:/.test(profilePath) &&
      !/[\u0000-\u001f\u007f]/.test(profilePath) &&
      !profilePath
        .replace(/\\/g, "/")
        .split("/")
        .some((part) => part === "" || part === "." || part === "..") &&
      typeof (profile as Record<string, unknown>).profileName === "string" &&
      (profile as Record<string, string>).profileName.length > 0 &&
      (profile as Record<string, string>).profileName.length <= 256 &&
      (profile as Record<string, string>).profileName.trim() ===
        (profile as Record<string, string>).profileName &&
      !/[\u0000-\u001f\u007f]/.test((profile as Record<string, string>).profileName));
  return (
    Number.isSafeInteger(candidate.tabSize) &&
    (candidate.tabSize as number) >= 1 &&
    (candidate.tabSize as number) <= 8 &&
    typeof candidate.insertSpaces === "boolean" &&
    (candidate.formatJavaOnType === undefined || typeof candidate.formatJavaOnType === "boolean") &&
    validProfile
  );
}

function readPreferences(workspaceId: string | null): PreferenceSnapshot {
  if (!workspaceId) {
    return {
      preferences: { ...DEFAULT_WORKSPACE_EDITOR_PREFERENCES },
      error: null,
    };
  }

  let serialized: string | null;
  try {
    serialized = globalThis.localStorage.getItem(storageKey(workspaceId));
  } catch {
    return {
      preferences: { ...DEFAULT_WORKSPACE_EDITOR_PREFERENCES },
      error: "Workspace editor preferences could not be read.",
    };
  }
  if (serialized === null) {
    return {
      preferences: { ...DEFAULT_WORKSPACE_EDITOR_PREFERENCES },
      error: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return {
      preferences: { ...DEFAULT_WORKSPACE_EDITOR_PREFERENCES },
      error: "Saved editor preferences are invalid. Existing data was preserved.",
    };
  }
  try {
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).version !== 1 ||
      !validPreferences((parsed as Record<string, unknown>).preferences)
    ) {
      return {
        preferences: { ...DEFAULT_WORKSPACE_EDITOR_PREFERENCES },
        error: "Saved editor preferences are invalid. Existing data was preserved.",
      };
    }
    return {
      preferences: {
        tabSize: (parsed as { preferences: WorkspaceEditorPreferences }).preferences.tabSize,
        insertSpaces: (parsed as { preferences: WorkspaceEditorPreferences }).preferences
          .insertSpaces,
        ...((parsed as { preferences: WorkspaceEditorPreferences }).preferences.formatJavaOnType === undefined ? {} : {
          formatJavaOnType: (parsed as { preferences: WorkspaceEditorPreferences }).preferences.formatJavaOnType,
        }),
        ...((parsed as { preferences: WorkspaceEditorPreferences }).preferences
          .javaFormatterProfile !== undefined
          ? {
              javaFormatterProfile: {
                ...(parsed as { preferences: WorkspaceEditorPreferences }).preferences
                  .javaFormatterProfile!,
              },
            }
          : {}),
      },
      error: null,
    };
  } catch {
    return {
      preferences: { ...DEFAULT_WORKSPACE_EDITOR_PREFERENCES },
      error: "Workspace editor preferences could not be read.",
    };
  }
}

/** Stores formatting indentation independently for each registered workspace. */
export function useWorkspaceEditorPreferences(workspaceId: string | null) {
  const [revision, setRevision] = useState(0);
  const [writeError, setWriteError] = useState<{
    workspaceId: string | null;
    message: string;
  } | null>(null);
  const snapshot = useMemo(() => readPreferences(workspaceId), [revision, workspaceId]);

  const save = useCallback(
    (preferences: WorkspaceEditorPreferences): boolean => {
      if (!workspaceId) return false;
      if (!validPreferences(preferences)) {
        setWriteError({
          workspaceId,
          message:
            "Workspace editor preferences contain invalid indentation or formatter profile settings.",
        });
        return false;
      }
      try {
        globalThis.localStorage.setItem(
          storageKey(workspaceId),
          JSON.stringify({ version: 1, preferences }),
        );
        setWriteError(null);
        setRevision((current) => current + 1);
        return true;
      } catch {
        setWriteError({
          workspaceId,
          message: "Workspace editor preferences could not be saved.",
        });
        return false;
      }
    },
    [workspaceId],
  );

  return {
    preferences: snapshot.preferences,
    error: writeError?.workspaceId === workspaceId ? writeError.message : snapshot.error,
    save,
  };
}
