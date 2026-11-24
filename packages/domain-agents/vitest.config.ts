import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Standalone (no `test.projects`) so @stryker-mutator/vitest-runner can
// resolve this config: it JSON.stringifies the resolved Vitest config, and
// the workspace-style `projects` array in the root config is circular and
// crashes that serialization. `root` is pinned to this file's own directory
// because Stryker invokes Vitest from the sandbox's repo root, not from
// here, and the include glob below is relative to `root`.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.test.ts'],
    environment: 'node',
  },
});
