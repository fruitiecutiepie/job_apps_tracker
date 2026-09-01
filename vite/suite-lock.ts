/**
 * One suite run on this machine at a time.
 *
 * The tests are gated on wall clock — a budget per test — but wall clock is a property
 * of the machine rather than of the code. Two runs at once on the same cores makes every
 * test several times slower without anything being wrong, and the failure that follows
 * reads as a regression rather than as contention. This repo is checked out as a dozen
 * worktrees on one laptop, so "at once" is not hypothetical.
 *
 * The lock is held across all of them, keyed by a fixed name in the temporary directory
 * rather than by anything under the checkout. It is taken by `mkdir`, which is atomic:
 * whoever creates the directory holds it, and everyone else waits.
 *
 * It is an optimisation and never a gate. Anything that could leave a run stuck waiting
 * — a holder that died, a holder that is simply slow, a lock nobody wants — gives way:
 * a dead holder's lock is taken over, and past `MAX_WAIT_MS` the run goes ahead anyway
 * and says so. Set `VITEST_NO_LOCK=1` to skip it entirely.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LOCK = join(tmpdir(), 'job-apps-tracker-suite.lock')
const HOLDER = join(LOCK, 'pid')

/** How long to wait for the run in front before going ahead regardless. */
const MAX_WAIT_MS = 15 * 60 * 1000
const POLL_MS = 500
/** How often to say something while waiting, so a wait never looks like a hang. */
const REPORT_MS = 15 * 1000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The pid holding the lock, or null if it is unheld or was not written yet. */
function holder(): number | null {
  try {
    const pid = Number(readFileSync(HOLDER, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function alive(pid: number): boolean {
  try {
    // Signal 0 tests for the process without touching it.
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means it exists and belongs to somebody else, which still counts.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function release(): void {
  if (holder() !== process.pid) return
  rmSync(LOCK, { force: true, recursive: true })
}

/** Takes the lock if it is free, reporting whether it now belongs to this run. */
function take(): boolean {
  try {
    mkdirSync(LOCK)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return false
  }
  writeFileSync(HOLDER, String(process.pid))
  return true
}

export default async function setup(context?: { config?: { watch?: boolean } }) {
  /*
   * Only a one-shot run takes the lock. Watch mode holds its session for as long as the
   * editor is open, which is the one way this could stop being an optimisation and start
   * being an obstruction.
   *
   * Confirmed positively rather than ruled out, because the signal is easy to read
   * backwards: vitest leaves `watch` undefined in watch mode and sets it to `false` for
   * `run`, so "not watching" and "not told" look alike. When neither the config nor the
   * command line says this is a one-shot run, the lock is skipped — an unheld lock costs
   * a slow run, a wrongly held one costs somebody their editor.
   */
  const oneShot = context?.config?.watch === false || process.argv.includes('run')
  if (process.env.VITEST_NO_LOCK === '1' || !oneShot) return

  const started = Date.now()
  let reported = 0

  while (!take()) {
    const pid = holder()

    // A run that died holding the lock is not a run to wait for.
    if (pid !== null && !alive(pid)) {
      rmSync(LOCK, { force: true, recursive: true })
      continue
    }

    const waited = Date.now() - started
    if (waited > MAX_WAIT_MS) {
      console.warn(
        `[suite lock] still held${pid ? ` by pid ${pid}` : ''} after ${Math.round(waited / 1000)}s; ` +
          'running anyway. Expect the timings to be worse than they should be.',
      )
      return
    }

    if (waited - reported >= REPORT_MS || reported === 0) {
      reported = waited
      console.log(
        `[suite lock] another run of this suite is in progress${pid ? ` (pid ${pid})` : ''}; ` +
          `waiting so the two do not share the cores. ${Math.round(waited / 1000)}s so far.`,
      )
    }

    await sleep(POLL_MS)
  }

  // Killed runs skip teardown, so the signals have to put it back themselves.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(signal, () => {
      release()
      process.exit(130)
    })
  }
  process.once('exit', release)

  return release
}
