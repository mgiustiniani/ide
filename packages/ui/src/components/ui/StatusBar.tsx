// ---------------------------------------------------------------------------
// @ide/ui – StatusBar
// VS‑Code‑style status bar showing cursor position, language mode,
// encoding, line endings, branch info.
// ---------------------------------------------------------------------------

export interface StatusBarItem {
  label: string;
  value: string;
}

export interface StatusBarProps {
  /** Left-aligned status items. */
  leftItems?: StatusBarItem[];
  /** Right-aligned status items. */
  rightItems?: StatusBarItem[];
  /** Optional branch/git info (e.g. "main"). */
  branch?: string;
}

export function StatusBar({
  leftItems = [],
  rightItems = [],
  branch,
}: StatusBarProps): JSX.Element {
  return (
    <div className="statusbar">
      <div className="statusbar-left">
        {leftItems.map((item, i) => (
          <span key={i} className="statusbar-item">
            {item.label && <span className="opacity-60 mr-0.5">{item.label}</span>}
            <span>{item.value}</span>
          </span>
        ))}
      </div>
      <div className="statusbar-right">
        {branch && (
          <span className="statusbar-item">
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="inline-block mr-0.5"
              aria-hidden="true"
            >
              <circle cx="4" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <circle cx="12" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <path
                d="M4 10.5V5a3 3 0 013 3v2"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M7 10h3"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            {branch}
          </span>
        )}
        {rightItems.map((item, i) => (
          <span key={i} className="statusbar-item">
            {item.label && <span className="opacity-60 mr-0.5">{item.label}</span>}
            <span>{item.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
