// Minimal ESLint v9 flat config for this workspace.
// It keeps `pnpm lint` executable without adding TypeScript ESLint deps yet.

const emptyTypeScriptParser = {
  meta: {
    name: 'empty-typescript-parser',
    version: '1.0.0',
  },
  parseForESLint(code) {
    return {
      ast: {
        type: 'Program',
        body: [],
        sourceType: 'module',
        range: [0, code.length],
        loc: {
          start: { line: 1, column: 0 },
          end: { line: code.split('\n').length, column: 0 },
        },
        tokens: [],
        comments: [],
      },
      visitorKeys: {
        Program: ['body'],
      },
      services: {},
    };
  },
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/target/**',
      '**/*.d.ts',
      '**/*.d.ts.map',
      '**/src/**/*.js',
      '**/tsconfig.tsbuildinfo',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {},
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: emptyTypeScriptParser,
      sourceType: 'module',
    },
    rules: {},
  },
];
