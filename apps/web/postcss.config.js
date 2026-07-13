import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../packages/ui/package.json', import.meta.url));
const tailwindcss = require('tailwindcss');
const autoprefixer = require('autoprefixer');
const tailwindConfig = fileURLToPath(
  new URL('../../packages/ui/tailwind.config.ts', import.meta.url),
);

export default {
  plugins: [tailwindcss({ config: tailwindConfig }), autoprefixer()],
};
