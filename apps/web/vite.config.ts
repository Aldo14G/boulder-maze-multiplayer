import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      // Consume the core TypeScript source directly for dev/HMR. The package's
      // own exports point at dist/, which is what real Node resolution uses
      // (proven by `npm run validate` and `npm run smoke`).
      '@boulder-maze/core': fileURLToPath(
        new URL('../../packages/core/src/index.ts', import.meta.url),
      ),
      // Wire protocol only — never the server entry, which imports `ws`.
      '@boulder-maze/server/protocol': fileURLToPath(
        new URL('../../apps/server/src/protocol.ts', import.meta.url),
      ),
    },
  },
  build: {
    target: 'es2022',
  },
});
