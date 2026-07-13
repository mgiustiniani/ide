import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "tailwindcss";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(packageRoot, "../..");

const config: Config = {
  content: [
    resolve(packageRoot, "src/**/*.{ts,tsx}"),
    resolve(workspaceRoot, "apps/web/src/**/*.{ts,tsx}"),
    resolve(workspaceRoot, "apps/desktop/src/**/*.{ts,tsx}"),
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // IDE brand colors
        primary: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
        surface: {
          DEFAULT: "#ffffff",
          dark: "#1e1e1e",
          darker: "#252526",
          light: "#f5f5f5",
        },
        accent: {
          green: "#22c55e",
          yellow: "#eab308",
          red: "#ef4444",
          blue: "#3b82f6",
          purple: "#a855f7",
          orange: "#f97316",
        },
      },
      spacing: {
        px: "1px",
        0: "0px",
        0.5: "2px",
        1: "4px",
        1.5: "6px",
        2: "8px",
        3: "12px",
        4: "16px",
        5: "20px",
        6: "24px",
        8: "32px",
        10: "40px",
        12: "48px",
        16: "64px",
        20: "80px",
        24: "96px",
      },
      fontSize: {
        xs: ["10px", { lineHeight: "14px" }],
        sm: ["12px", { lineHeight: "16px" }],
        base: ["14px", { lineHeight: "20px" }],
        lg: ["16px", { lineHeight: "24px" }],
        xl: ["18px", { lineHeight: "28px" }],
        "2xl": ["20px", { lineHeight: "28px" }],
        "3xl": ["24px", { lineHeight: "32px" }],
        "4xl": ["28px", { lineHeight: "36px" }],
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', "Fira Code", "monospace"],
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      borderRadius: {
        sm: "2px",
        DEFAULT: "4px",
        md: "6px",
        lg: "8px",
        xl: "12px",
        "2xl": "16px",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0, 0, 0, 0.05)",
        DEFAULT: "0 1px 3px rgba(0, 0, 0, 0.1)",
        md: "0 4px 6px rgba(0, 0, 0, 0.1)",
        lg: "0 10px 15px rgba(0, 0, 0, 0.1)",
        xl: "0 20px 25px rgba(0, 0, 0, 0.1)",
      },
    },
  },
  plugins: [],
};

export default config;
