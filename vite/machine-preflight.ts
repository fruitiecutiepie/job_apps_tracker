/**
 * What the machine is doing before a browser suite asks it for three browsers.
 *
 * The browser suite is gated on wall clock like the rest, but a browser costs far more to
 * stand up than a jsdom environment, and this laptop is not always in a state to give it.
 * Measured here: launching a browser and rendering a bare heading took 37s in Chromium, 24s
 * in WebKit and 106s in Firefox with the load average around 313 on ten cores. At that
 * point a failure says nothing about the code, and the run has already cost ten minutes to
 * find that out.
 *
 * So this says what the load is before any of that happens, waits a little for it to come
 * down, and — whatever it finds — leaves the numbers in the output. A timeout further down
 * is then readable rather than a mystery: AGENTS.md asks for a measurement before treating
 * one as a regression, and this is that measurement, taken before rather than after.
 *
 * Like `suite-lock`, it is an optimisation and never a gate. It gives up waiting, it never
 * refuses to run, and `VITEST_NO_PREFLIGHT=1` skips it. A preflight that can stop a run is
 * worse than the slow run it was trying to save.
 */

import { cpus, loadavg } from 'node:os'

/**
 * Load per core past which a browser is likely to be slower than its own timeouts.
 *
 * Set from measurement rather than from taste, and it is deliberately high. This laptop
 * sits around eight or nine times its core count while doing nothing in particular, and
 * the whole browser suite passes there. What did not work was around thirty-one times,
 * where Firefox could not be reached inside a minute at all. A threshold near the idle
 * figure would mean waiting before every run and learning nothing; this one only fires
 * when the machine is in the state that actually breaks a browser.
 */
const BUSY_RATIO = 20

/**
 * How long to give the machine to settle before going ahead regardless. Short, because
 * waiting is the expensive part and the reading is the useful part: a run that waits a
 * minute and a half and then goes anyway has cost a minute and a half.
 */
const MAX_WAIT_MS = 90 * 1000
const POLL_MS = 5 * 1000
/** How often to say something while waiting, so a wait never looks like a hang. */
const REPORT_MS = 20 * 1000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface Reading {
  load: number
  cores: number
  ratio: number
}

export function read(load = loadavg()[0], cores = cpus().length): Reading {
  // A machine reporting no cores is not a machine to divide by.
  const safeCores = cores > 0 ? cores : 1
  return { load, cores: safeCores, ratio: load / safeCores }
}

export function describe({ load, cores, ratio }: Reading): string {
  return `load ${load.toFixed(1)} across ${cores} cores, ${ratio.toFixed(1)}x per core`
}

export default async function setup(context?: { config?: { watch?: boolean } }) {
  /*
   * One-shot runs only, and confirmed positively rather than ruled out, for the reason
   * `suite-lock` gives: vitest leaves `watch` undefined in watch mode and sets it false
   * for `run`, so "not watching" and "not told" look the same.
   */
  const oneShot = context?.config?.watch === false || process.argv.includes('run')
  if (process.env.VITEST_NO_PREFLIGHT === '1' || !oneShot) return

  /*
   * Always says what it found, whether or not it waits. This is the measurement AGENTS.md
   * asks for before a timeout is read as a regression, and having it in the output before
   * the run is worth more than having to go and take it afterwards.
   */
  const first = read()
  if (first.ratio <= BUSY_RATIO) {
    console.log(`[preflight] ${describe(first)}. Fine for a browser.`)
    return
  }

  const started = Date.now()
  let reported = 0

  for (;;) {
    const now = read()
    if (now.ratio <= BUSY_RATIO) {
      console.log(`[preflight] settled to ${describe(now)}; going ahead.`)
      return
    }

    const waited = Date.now() - started
    if (waited > MAX_WAIT_MS) {
      console.warn(
        `[preflight] still busy after ${Math.round(waited / 1000)}s: ${describe(now)}. `
          + 'Running anyway. Expect a browser to be slow to start, and read a timeout as '
          + 'this rather than as a regression — the budgets in vitest.browser.config.ts are '
          + 'generous for exactly this reason. Running one browser at a time '
          + '(`--project=chromium`) is the quickest way to get a signal from a busy machine.',
      )
      return
    }

    if (reported === 0 || waited - reported >= REPORT_MS) {
      reported = waited
      console.log(
        `[preflight] ${describe(now)}, which is more than ${BUSY_RATIO}x per core; `
          + `waiting for it to come down. ${Math.round(waited / 1000)}s so far.`,
      )
    }

    await sleep(POLL_MS)
  }
}
