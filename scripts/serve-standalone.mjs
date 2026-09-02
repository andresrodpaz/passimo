/**
 * Runs the production build the way the deployment runs it.
 *
 *   pnpm build && pnpm start
 *
 * `next.config.mjs` sets `output: 'standalone'`, and Next says plainly on every
 * boot that `next start` "does not work with output: standalone" — the entry
 * point for a standalone build is `.next/standalone/server.js`, which is what the
 * Dockerfile and `railway.json` both invoke. So `pnpm start` used to launch a
 * server that printed a warning about itself and served from a tree the
 * deployment never uses: the local "does the production build actually work?"
 * check was testing a different thing from production.
 *
 * The standalone output ships its own traced `node_modules` and its own server,
 * but Next deliberately does **not** copy the two directories that are served as
 * plain files — `.next/static` and `public`. The Dockerfile copies them in as
 * separate layers. This does the same, then execs the server, so a local run has
 * working CSS, fonts and images rather than a page of unstyled HTML that looks
 * like a broken build.
 *
 * Migrations are not run here. `pnpm start:migrate` composes the two, matching
 * the deploy command, and keeping them separate means a local production check
 * against an already-migrated database does not need write access to it.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const ROOT = process.cwd()
const STANDALONE = join(ROOT, '.next', 'standalone')
const SERVER = join(STANDALONE, 'server.js')

if (!existsSync(SERVER)) {
  process.stderr.write(
    `\n  No standalone build found at ${SERVER}\n` +
      '  Run `pnpm build` first.\n\n'
  )
  process.exit(1)
}

/**
 * Copy, every time, rather than only when missing.
 *
 * A rebuild changes the hashed filenames under `.next/static`; a stale copy
 * serves 404s for assets whose names moved, which presents as a build that
 * "works" until you look at the page. Copying is cheap and idempotent, and
 * getting it wrong is invisible.
 */
for (const [from, to] of [
  [join(ROOT, '.next', 'static'), join(STANDALONE, '.next', 'static')],
  [join(ROOT, 'public'), join(STANDALONE, 'public')],
]) {
  if (!existsSync(from)) continue
  mkdirSync(to, { recursive: true })
  cpSync(from, to, { recursive: true })
}

const child = spawn(process.execPath, [SERVER], {
  cwd: STANDALONE,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: process.env.PORT ?? '3000',
    HOSTNAME: process.env.HOSTNAME ?? '0.0.0.0',
  },
})

// Forward the signals a container or a Ctrl-C sends, so the server shuts down
// rather than being orphaned when this wrapper exits.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0))
})
