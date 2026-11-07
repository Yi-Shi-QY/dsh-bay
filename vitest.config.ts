import { defineConfig } from 'vitest/config'
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    // The current DSH Bay candidate owns Core only. Conversation Suite remains
    // outside the package boundary and is never part of the candidate gate.
    include: ['packages/workbench-core/tests/**/*.spec.ts*'],
    // The historical pet fixture is outside the Core-only candidate and must
    // not be part of its automated gate.
    exclude: [
      '**/node_modules/**', '**/.git/**',
      'packages/workbench-core/tests/workbench-pet-extension-compat.spec.ts',
    ],
    server: { deps: { inline: [/@deepseek-ai\/dsh-client-/] } },
    // Windows acceptance Profiles can deny Vitest's temporary fork directory.
    // Serial file execution keeps the same assertions deterministic without
    // depending on a user-wide TEMP ACL.
    fileParallelism: false,
    testTimeout: 15000,
  },
})
