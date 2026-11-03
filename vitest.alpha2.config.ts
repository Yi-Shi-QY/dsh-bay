import { defineConfig } from 'vitest/config'
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    // The 0.2.1 candidate owns Core only. Conversation Suite remains a
    // source-retained compatibility line and is exercised explicitly through
    // the legacy-suite test command, never as part of the candidate gate.
    include: ['packages/workbench-core/tests/**/*.spec.ts*'],
    // The historical pet fixture is intentionally outside the Alpha.14
    // Core-only candidate and must not be part of its automated gate.
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
