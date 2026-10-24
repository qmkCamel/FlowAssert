import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Integration fixtures spawn Git/Node processes and hash toolchains. Bound
    // file-level concurrency so CPU-count defaults do not exhaust their budgets.
    maxWorkers: 2,
    exclude: ['tests/e2e/**', 'node_modules/**', 'lib/**', '.worktrees/**', '.pnpm-store/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
})
