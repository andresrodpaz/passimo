import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Integration tests: real PostgreSQL, no mocks.
 *
 * Separate from `vitest.config.ts` on purpose. `pnpm test` must stay fast and
 * runnable with nothing installed but Node — a unit suite that needs a database
 * is a unit suite people stop running. These need one:
 *
 *   pnpm db:up && pnpm db:migrate && pnpm test:integration
 *
 * What they cover is exactly what a mock cannot: that the query layer emits SQL
 * PostgreSQL accepts, that the schema's constraints do what the code assumes,
 * and that a merchant cannot read another merchant's data.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/integration/**/*.test.ts'],
    /*
     * Serial. Every file creates and drops its own tenants, and the tenant
     * isolation tests assert on counts — parallel workers sharing one database
     * would make those flaky for reasons that have nothing to do with the code.
     */
    fileParallelism: false,
    // Password hashing is deliberately slow (scrypt), and the seeded fixtures
    // create several accounts.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
