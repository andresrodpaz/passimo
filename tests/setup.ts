/**
 * Vitest global setup.
 *
 * Server modules read secrets through `lib/env` at call time; providing them
 * here keeps every test file free of import-order gymnastics.
 *
 * `DATABASE_URL` points at the same local container the app uses, so the
 * integration tests in `tests/integration/` can run against a real PostgreSQL.
 * Unit tests never open a connection — the pool is lazy — so a missing database
 * fails only the tests that genuinely need one, rather than the whole suite.
 */
process.env.APP_TOKEN_SECRET ??= 'test-secret-value-for-unit-tests-only-0123456789'
process.env.AUTH_SESSION_SECRET ??= 'test-session-secret-for-unit-tests-only-9876543210'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'
process.env.DATABASE_URL ??= 'postgresql://passimo:passimo@127.0.0.1:5433/passimo'
process.env.STORAGE_DRIVER ??= 'local'
process.env.STORAGE_LOCAL_DIR ??= '.uploads-test'

export {}
