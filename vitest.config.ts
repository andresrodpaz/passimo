import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // `server-only` throws outside a React Server Component. Under Vitest we
      // are deliberately testing server modules directly, so it becomes a no-op.
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      /*
       * The money-affecting *pure* logic. Failures here cost merchants real
       * revenue, so it carries a hard coverage floor rather than a project-wide
       * average that a pile of trivial UI tests could satisfy.
       *
       * Deliberately excludes modules whose bodies are database orchestration
       * (`segments/resolve.ts`, the service layer, the job handlers). Reaching
       * 80% on those would mean asserting against a mocked database client, which
       * tests the mock rather than the query. Those are covered for real by
       * `vitest.integration.config.ts`, which runs against PostgreSQL, and by the
       * Playwright suite.
       */
      include: [
        'lib/loyalty/rules.ts',
        /*
         * The proximity engines. These decide whether a real person's phone buzzes,
         * and both failure modes are invisible in production: an over-eager rule
         * costs the merchant the wallet pass permanently — a deleted card cannot be
         * re-permissioned — while an over-strict one silently sends nothing and reads
         * as "the feature is broken". Neither appears in an error log, so they carry
         * the same hard floor as the money-affecting logic.
         */
        'lib/wallet/geo.ts',
        'lib/wallet/eligibility.ts',
        'lib/wallet/rules.ts',
        // The mechanism that stops a page rendering half in English.
        'lib/i18n/translate.ts',
        'lib/i18n/locales.ts',
        // Every check-in in the product starts by classifying a scanned string.
        // Getting it wrong serves the wrong customer or spends the wrong gift
        // card, so it carries the same floor as the rules engine.
        'lib/scan/payload.ts',
        'lib/segments/compile.ts',
        'lib/segments/definition.ts',
        'lib/messaging/template.ts',
        'lib/customers/import.ts',
        'lib/crypto.ts',
        'lib/errors.ts',
        // The plan catalogue decides what every merchant may do and what we are
        // paid for it; a mistake here either gives a paid feature away or blocks
        // someone who paid.
        'lib/billing/plans.ts',
        /*
         * The failure paths added for launch. Every one of them is invisible in
         * production when it goes wrong — that is the property they share, and
         * the reason they are held to the same floor as the money logic rather
         * than to a project-wide average:
         *
         *   * `dunning` decides whether a declined card ends in a warned
         *     merchant or a silently paused workspace;
         *   * `webhook-idempotency` decides whether a replayed Stripe event is
         *     applied twice or lost entirely;
         *   * `sync-state` decides whether a customer whose Google pass failed
         *     to update ever gets a correct balance again;
         *   * `rate-limit-cache` is the only unbounded-growth surface in a
         *     request path, on the highest-volume endpoint in the product;
         *   * `onboarding/checklist` is what a new merchant meets on day one.
         *
         * None of them raise an alert when they misbehave. They just go quiet.
         */
        'lib/billing/dunning.ts',
        'lib/billing/webhook-idempotency.ts',
        'lib/wallet/sync-state.ts',
        'lib/rate-limit-cache.ts',
        'lib/onboarding/checklist.ts',
        'lib/onboarding/presets.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
})
