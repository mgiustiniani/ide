import { useCallback, useMemo, useState } from "react";

const STORAGE_KEY = "ide.java.language-server-runtime.v1";

type RuntimePreferenceSnapshot = {
  serverJdkHome: string;
  error: string | null;
};

function validServerJdkHome(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 4096 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    (value === "" || /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value))
  );
}

function readPreference(): RuntimePreferenceSnapshot {
  let serialized: string | null;
  try {
    serialized = globalThis.localStorage.getItem(STORAGE_KEY);
  } catch {
    return { serverJdkHome: "", error: "The JDT LS runtime preference could not be read." };
  }
  if (serialized === null) return { serverJdkHome: "", error: null };

  try {
    const parsed: unknown = JSON.parse(serialized);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).version !== 1 ||
      !validServerJdkHome((parsed as Record<string, unknown>).serverJdkHome)
    ) {
      return {
        serverJdkHome: "",
        error: "The saved JDT LS runtime preference is invalid. Existing data was preserved.",
      };
    }
    return {
      serverJdkHome: (parsed as { serverJdkHome: string }).serverJdkHome,
      error: null,
    };
  } catch {
    return {
      serverJdkHome: "",
      error: "The saved JDT LS runtime preference is invalid. Existing data was preserved.",
    };
  }
}

/** Persists the JDK used to launch JDT LS independently of each project's selected JDK. */
export function useJavaLanguageServerRuntimePreference() {
  const [revision, setRevision] = useState(0);
  const [writeError, setWriteError] = useState<string | null>(null);
  const snapshot = useMemo(() => readPreference(), [revision]);

  const save = useCallback((serverJdkHome: string): boolean => {
    if (!validServerJdkHome(serverJdkHome)) {
      setWriteError(
        "Enter an absolute JDK home path without surrounding spaces or control characters.",
      );
      return false;
    }
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, serverJdkHome }));
      setWriteError(null);
      setRevision((current) => current + 1);
      return true;
    } catch {
      setWriteError("The JDT LS runtime preference could not be saved.");
      return false;
    }
  }, []);

  return {
    serverJdkHome: snapshot.serverJdkHome,
    error: writeError ?? snapshot.error,
    save,
  };
}
