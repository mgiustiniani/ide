// ---------------------------------------------------------------------------
// @ide/ui – PanelLayout StatusBar
// VS‑Code‑style status bar showing cursor position, language mode,
// encoding, line endings, and git branch info.
// ---------------------------------------------------------------------------

import { Icon } from '../ui/Icon';

export interface StatusBarProps {
  /** Cursor line number (default "1"). */
  line?: number;
  /** Cursor column number (default "1"). */
  column?: number;
  /** Language mode label (default "TypeScript"). */
  language?: string;
  /** File encoding (default "UTF-8"). */
  encoding?: string;
  /** Line endings format (default "LF"). */
  lineEndings?: 'LF' | 'CRLF';
  /** Git branch name (default "main"). */
  branch?: string;
}

export function StatusBar({
  line = 1,
  column = 1,
  language = 'TypeScript',
  encoding = 'UTF-8',
  lineEndings = 'LF',
  branch = 'main',
}: StatusBarProps): JSX.Element {
  return (
    <div className="statusbar statusbar-gradient">
      <div className="statusbar-left">
        <span className="statusbar-item">
          <Icon type="git-branch" size={12} className="mr-0.5" />
          {branch}
        </span>
      </div>
      <div className="statusbar-right">
        <span className="statusbar-item">
          <Icon type="circle-filled" size={10} className="mr-1 opacity-70" />
          <span className="opacity-60 mr-0.5">Ln</span>
          {line}
          <span className="opacity-60 mx-0.5">, Col</span>
          {column}
        </span>
        <span className="statusbar-item">
          <Icon type="circle-filled" size={10} className="mr-1 opacity-70" />
          {language}
        </span>
        <span className="statusbar-item">
          <Icon type="circle-filled" size={10} className="mr-1 opacity-70" />
          <span className="opacity-60 mr-0.5">{encoding}</span>
        </span>
        <span className="statusbar-item">
          <Icon type="circle-filled" size={10} className="mr-1 opacity-70" />
          {lineEndings}
        </span>
        <span className="statusbar-item">
          <Icon type="circle-filled" size={10} className="mr-1 opacity-70" />
          <span className="opacity-60 mr-0.5">Editor</span>
          <span>VS Code</span>
        </span>
      </div>
    </div>
  );
}
