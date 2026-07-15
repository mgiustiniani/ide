import { useId, useState, type FormEvent } from "react";

const MAX_FILE_NAME_LENGTH = 255;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export interface WelcomePageProps {
  /** Called with a validated basename. The application owns file creation. */
  onCreateNewFile?: (name: string) => void | Promise<void>;
  /** Optional destination shown below the filename field. */
  createFileTargetLabel?: string;
  onOpenRecent?: () => void;
  recentFiles?: { name: string; path: string }[];
  onRecentFileClick?: (path: string) => void;
}

function validateFileName(value: string): string | null {
  if (value.length === 0) return "Enter a file name.";
  if (value.length > MAX_FILE_NAME_LENGTH)
    return `File name must be ${MAX_FILE_NAME_LENGTH} characters or fewer.`;
  if (value === "." || value === "..") return "File name cannot be “.” or “..”.";
  if (value.includes("/") || value.includes("\\")) return "Enter a file name without folders.";
  if (CONTROL_CHARACTER_PATTERN.test(value))
    return "File name contains an unsupported control character.";
  return null;
}

/** A restrained, Kate-like empty editor state. */
export function WelcomePage({
  onCreateNewFile,
  createFileTargetLabel,
  onOpenRecent,
  recentFiles,
  onRecentFileClick,
}: WelcomePageProps): JSX.Element {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const targetId = `${inputId}-target`;
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const normalizedName = fileName.trim();
    const validationError = validateFileName(normalizedName);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    if (!onCreateNewFile) return;

    setIsCreating(true);
    try {
      await onCreateNewFile(normalizedName);
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message.trim()
          ? reason.message
          : "The file could not be created.",
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section
      className="welcome-page"
      data-testid="welcome-page"
      aria-labelledby="empty-editor-title"
    >
      <div className="welcome-page-main">
        <svg
          className="welcome-page-icon"
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          aria-hidden="true"
        >
          <path d="M11.5 5.5h17l8 8v29h-25z" stroke="currentColor" strokeWidth="1.5" />
          <path d="M28.5 5.5v8h8" stroke="currentColor" strokeWidth="1.5" />
          <path d="M17 23.5h14M17 29h14M17 34.5h9" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <div>
          <h2 id="empty-editor-title">No document open</h2>
          <p>Select a file from the explorer to begin editing.</p>
        </div>
      </div>

      <form
        className="welcome-create-form"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        <label htmlFor={inputId}>Create a new file</label>
        <div className="welcome-create-row">
          <input
            id={inputId}
            type="text"
            value={fileName}
            maxLength={MAX_FILE_NAME_LENGTH + 1}
            onChange={(event) => {
              setFileName(event.currentTarget.value);
              if (error) setError(null);
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={
              [error ? errorId : null, createFileTargetLabel ? targetId : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            placeholder="File name"
            autoComplete="off"
            disabled={isCreating}
          />
          <button type="submit" disabled={isCreating}>
            Create File
          </button>
        </div>
        {createFileTargetLabel && (
          <p id={targetId} className="welcome-create-target">
            Location: {createFileTargetLabel}
          </p>
        )}
        {error && (
          <p id={errorId} className="welcome-create-error" role="alert">
            {error}
          </p>
        )}
      </form>

      <div className="welcome-recent">
        <div className="welcome-recent-heading">
          <h3>Open Recent</h3>
          {onOpenRecent && (
            <button type="button" onClick={onOpenRecent}>
              Browse…
            </button>
          )}
        </div>
        {recentFiles && recentFiles.length > 0 ? (
          <ul>
            {recentFiles.map((file) => (
              <li key={file.path}>
                <button type="button" onClick={() => onRecentFileClick?.(file.path)}>
                  <span>{file.name}</span>
                  <small>{file.path}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="welcome-recent-empty">No recent files</p>
        )}
      </div>
    </section>
  );
}
