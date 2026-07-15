// ---------------------------------------------------------------------------
// Vitest Global Setup
// ---------------------------------------------------------------------------
// Provides global mocks for browser APIs that are not available in jsdom.
// ---------------------------------------------------------------------------

import { vi } from "vitest";

// ── Mock matchMedia ─────────────────────────────────────────────────────

Object.defineProperty(globalThis, "matchMedia", {
  value: vi.fn(() => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ── Mock localStorage ───────────────────────────────────────────────────

const store: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const k in store) delete store[k];
    }),
    length: 0,
    key: vi.fn((_: number) => null),
  },
});

// ── Mock ResizeObserver ─────────────────────────────────────────────────

Object.defineProperty(globalThis, "ResizeObserver", {
  value: vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
});

// ── Mock HTMLCanvasElement.getContext ───────────────────────────────────

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: vi.fn(() => ({
    canvas: null,
    // Return a minimal mock context object for xterm.js
    getImageData: () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
    putImageData: vi.fn(),
    createImageData: () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getContextAttributes: () => ({}) as CanvasRenderingContext2DSettings,
    getTransform: () => ({}) as DOMMatrix,
    getCanvasRenderingContext2D: () => null,
    getHTMLCanvasElement: () => null,
  })),
});
