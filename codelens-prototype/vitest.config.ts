import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      react: fileURLToPath(new URL('node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('node_modules/react-dom', import.meta.url)),
    },
  },
  test: {
    include: ['doc/frontend/*.test.{mjs,jsx}'],
    globals: true,
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      include: ['codelens-prototype/src/**/*.{ts,tsx}'],
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'htmlcov/frontend',
    },
  },
});
