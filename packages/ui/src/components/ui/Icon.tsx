// ---------------------------------------------------------------------------
// @ide/ui – Icon
// Detailed SVG icon set for files, folders, actions, and language badges.
// All icons use currentColor for easy theme integration.
// ---------------------------------------------------------------------------

import type { CSSProperties } from 'react';

export type IconType =
  | 'file'
  | 'folder'
  | 'folder-open'
  | 'chevron-right'
  | 'chevron-down'
  | 'close'
  | 'terminal'
  | 'search'
  | 'settings'
  | 'plus'
  | 'minus'
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'css'
  | 'html'
  | 'markdown'
  | 'image'
  | 'react'
  | 'maven'
  | 'git-branch'
  | 'git-commit'
  | 'ellipsis'
  | 'spinner'
  | 'circle-filled';

export interface IconProps {
  /** Which icon to render. */
  type: IconType;
  /** CSS class name override. */
  className?: string;
  /** Inline style override. */
  style?: CSSProperties;
  /** Width/height in pixels (default 16). */
  size?: number;
}

/**
 * Render a small inline SVG icon.
 * Default colour is currentColor so it inherits the parent text colour.
 */
export function Icon({
  type,
  className,
  style,
  size = 16,
}: IconProps): JSX.Element {
  const svgProps = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'currentColor',
    xmlns: 'http://www.w3.org/2000/svg',
    className: `inline-block shrink-0 ${className ?? ''}`,
    style,
    'aria-hidden': true,
    'data-icon-type': type,
  };

  switch (type) {
    case 'file':
      return (
        <svg {...svgProps}>
          <path d="M2 1.5A1.5 1.5 0 013.5 0h5a1.5 1.5 0 011.06.44l3 3A1.5 1.5 0 0113 4.5V14.5A1.5 1.5 0 0111.5 16h-8A1.5 1.5 0 012 14.5V1.5z" />
          <path d="M6 8l2 2-2 2" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
        </svg>
      );

    case 'folder':
      return (
        <svg {...svgProps}>
          <path
            d="M1.5 4.25A1.75 1.75 0 013.25 2.5h3.1c.4 0 .78.16 1.06.44l1.31 1.31h4.03A1.75 1.75 0 0114.5 6v1H1.5V4.25z"
            opacity="0.55"
          />
          <path d="M1.5 6A1.5 1.5 0 013 4.5h10A1.5 1.5 0 0114.5 6v6.5A1.5 1.5 0 0113 14H3a1.5 1.5 0 01-1.5-1.5V6z" />
          <path d="M2.75 7h10.5" stroke="currentColor" fill="none" strokeWidth="1" strokeLinecap="round" opacity="0.25" />
        </svg>
      );

    case 'folder-open':
      return (
        <svg {...svgProps}>
          <path
            d="M1.5 4.25A1.75 1.75 0 013.25 2.5h3.1c.4 0 .78.16 1.06.44l1.31 1.31h4.03A1.75 1.75 0 0114.5 6v1.25H3.85A2.5 2.5 0 001.5 8.9V4.25z"
            opacity="0.5"
          />
          <path d="M3.85 6.75h10a1.25 1.25 0 011.23 1.48l-.82 4.4A1.75 1.75 0 0112.54 14H3.04a1.75 1.75 0 01-1.72-2.07l.57-3.06a2.5 2.5 0 012.46-2.12z" />
          <path d="M3.25 8.25h10.25" stroke="currentColor" fill="none" strokeWidth="1" strokeLinecap="round" opacity="0.25" />
        </svg>
      );

    case 'chevron-right':
      return (
        <svg {...svgProps}>
          <path d="M6 4l4 4-4 4" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'chevron-down':
      return (
        <svg {...svgProps}>
          <path d="M4 6l4 4 4-4" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'close':
      return (
        <svg {...svgProps}>
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'terminal':
      return (
        <svg {...svgProps}>
          <path d="M3 3l5 5-5 5" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 12h5" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'search':
      return (
        <svg {...svgProps}>
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" fill="none" strokeWidth="1.5" />
          <path d="M10 10l3 3" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'settings':
      return (
        <svg {...svgProps}>
          <circle cx="8" cy="8" r="2.5" stroke="currentColor" fill="none" strokeWidth="1.5" />
          <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3 3l.7.7M11 11l.7.7M3 13l.7-.7M11 5l.7-.7" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'plus':
      return (
        <svg {...svgProps}>
          <path d="M8 3v10M3 8h10" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'minus':
      return (
        <svg {...svgProps}>
          <path d="M3 8h10" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'typescript':
      return (
        <svg {...svgProps} fill="none">
          <rect x="2" y="2" width="12" height="12" rx="2" fill="#3178c6" />
          <path d="M4.5 9.5V10.5H7v-1H4.5z" fill="#ffffff" />
          <path d="M8 8.5h3v1.5H9.5v-1H11v1.5H8V8.5z" fill="#ffffff" />
          <path d="M4.5 7V8H7V7H4.5z" fill="#ffffff" opacity="0.8" />
          <path d="M8 7h3V8H8V7z" fill="#ffffff" opacity="0.8" />
        </svg>
      );

    case 'javascript':
      return (
        <svg {...svgProps} fill="none">
          <rect x="2" y="2" width="12" height="12" rx="2" fill="#f7df1e" />
          <path d="M6 9.5V8.5H5v1.5h3V8.5H7.5v1H6z" fill="#000000" />
          <path d="M9 8.5V10H8V8.5h1z" fill="#000000" />
          <path d="M9 10.5h1v-1H9v1z" fill="#000000" />
          <path d="M4.5 7.5h7V8h-7z" fill="#000000" opacity="0.5" />
        </svg>
      );

    case 'json':
      return (
        <svg {...svgProps} fill="none">
          <rect x="2" y="2" width="12" height="12" rx="2" fill="#8bc34a" />
          <path d="M5.5 6.5L4 8l1.5 1.5" stroke="#ffffff" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10.5 6.5L12 8l-1.5 1.5" stroke="#ffffff" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8.5 5.5l-1 5" stroke="#ffffff" strokeWidth="0.8" strokeLinecap="round" />
        </svg>
      );

    case 'css':
      return (
        <svg {...svgProps} fill="none">
          <rect x="2" y="2" width="12" height="12" rx="2" fill="#2965f1" />
          <path d="M4.5 6.5h7M5 8h6M5.5 9.5h5" stroke="#ffffff" strokeWidth="0.8" strokeLinecap="round" />
          <path d="M6 11l2-1 2 1" stroke="#ffffff" strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      );

    case 'html':
      return (
        <svg {...svgProps} fill="none">
          <rect x="2" y="2" width="12" height="12" rx="2" fill="#e44d26" />
          <path d="M5 6l-1 2 1 2" stroke="#ffffff" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M11 6l1 2-1 2" stroke="#ffffff" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M7.5 5.5l-1 5" stroke="#ffffff" strokeWidth="0.6" strokeLinecap="round" opacity="0.7" />
          <path d="M8.5 5.5l1 5" stroke="#ffffff" strokeWidth="0.6" strokeLinecap="round" opacity="0.7" />
        </svg>
      );

    case 'markdown':
      return (
        <svg {...svgProps} fill="none">
          <rect x="2" y="2" width="12" height="12" rx="2" fill="#6a6a6a" />
          <path d="M5 7v4h2V7l1.5 2L10 7v4h2V7" stroke="#ffffff" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case 'image':
      return (
        <svg {...svgProps} fill="none">
          <rect x="2" y="2" width="12" height="12" rx="2" fill="#9b59b6" />
          <circle cx="5.5" cy="5.5" r="1" fill="#ffffff" opacity="0.8" />
          <path d="M3 13l3-5 2 2 3-3 3 6" stroke="#ffffff" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      );

    case 'react':
      return (
        <svg {...svgProps} fill="none">
          <rect x="2" y="2" width="12" height="12" rx="2" fill="#149eca" />
          <circle cx="8" cy="8" r="1.5" fill="#ffffff" />
          <ellipse cx="8" cy="8" rx="4" ry="1.5" stroke="#ffffff" strokeWidth="0.6" fill="none" />
          <ellipse cx="8" cy="8" rx="1.5" ry="4" stroke="#ffffff" strokeWidth="0.6" fill="none" />
        </svg>
      );

    case 'maven':
      return (
        <svg {...svgProps} fill="none">
          <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="#f97316" />
          <path d="M3.5 11.75V4.25h2L8 8l2.5-3.75h2v7.5h-2V7.4L8 10.9 5.5 7.4v4.35h-2z" fill="#ffffff" />
          <path d="M3.5 3.25h9" stroke="#7c2d12" strokeWidth=".75" strokeLinecap="round" opacity=".75" />
        </svg>
      );

    case 'git-branch':
      return (
        <svg {...svgProps} fill="none">
          <circle cx="4" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <circle cx="12" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <path d="M4 10.5V5a3 3 0 013 3v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
          <path d="M7 10h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
        </svg>
      );

    case 'git-commit':
      return (
        <svg {...svgProps} fill="none">
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <path d="M8 5V3M8 13V11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
        </svg>
      );

    case 'ellipsis':
      return (
        <svg {...svgProps}>
          <circle cx="4" cy="8" r="1" fill="currentColor" />
          <circle cx="8" cy="8" r="1" fill="currentColor" />
          <circle cx="12" cy="8" r="1" fill="currentColor" />
        </svg>
      );

    case 'circle-filled':
      return (
        <svg {...svgProps}>
          <circle cx="8" cy="8" r="4" fill="currentColor" />
        </svg>
      );

    case 'spinner':
      return (
        <svg {...svgProps} className={`inline-block shrink-0 animate-spin ${className ?? ''}`}>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.25" />
          <path d="M8 2a6 6 0 016 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      );

    default:
      return <span className="inline-block" style={{ width: size, height: size }} />;
  }
}
