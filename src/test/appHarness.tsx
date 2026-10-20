/**
 * Mounting the whole app for the browser suite.
 *
 * The panel harness mounts one component under stub callbacks. That is the right size for
 * the panel, and the wrong one for the surfaces that live in the shell: the board and the
 * table size themselves against the topbar, the context bar and the page around them, and
 * the demo's nineteen applications are what give them anything to lay out. Mounting the
 * real `App` is the only way to measure either.
 *
 * It runs on the static build's backend, not the dev server's. The dev server's `/__db`
 * reads and writes the user's real `data/tracker.json`, and this suite has no route for it
 * on purpose (see `vitest.browser.config.ts`); the static backend keeps its document in the
 * browser's own IndexedDB, which a test can empty without reaching anything of the user's.
 * Under the demo profile its first visit seeds the same nineteen deterministic examples the
 * dev server's demo does, so the data is the data every other suite reads.
 *
 * Three things have to be true before the app is measured, and each is done here rather than
 * left to the test, because forgetting one produces a layout that is plausible and wrong:
 *
 * - The backend is chosen when its module first evaluates, so the browser config sets
 *   `VITE_TRACKER_BACKEND` for the whole suite rather than a test stubbing it: a test file
 *   importing anything that reaches the backend evaluates it before its body runs, and a
 *   stub there is too late. The profile is read when it is asked for, so it is stubbed here.
 * - The storage is empty. The demo seeds only on a tracker's first visit to the browser, so
 *   a database left by an earlier run would open on whatever it held, or on an empty tracker.
 * - `Date` is the demo's reference. The seeds are measured from that instant, and a view's
 *   "today" decides its bands, its idle marks and its overdue dates; on the real clock the
 *   board drifts away from its own seed data, one boundary at a time.
 */

import { screen, waitFor } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { expect, vi } from 'vitest'

import { DEFAULT_DEMO_REFERENCE } from '../domain/demo'

/** Both of the static build's databases, so a test never opens on a neighbour's leftovers. */
const DATABASES = ['job-applications-tracker', 'job-applications-tracker-demo']

/** Wider than every breakpoint the shell has, the way the panel harness's `WIDE` is. */
export const DESKTOP = { width: 1280, height: 800 }

/** A phone, narrow enough to be under the topbar's 1000px and the table's own wrapping. */
export const PHONE = { width: 375, height: 812 }

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error(`Could not clear ${name}`))
    // A connection a previous test left open lets go on `versionchange`; wait for it.
  })
}

async function clearStorage(): Promise<void> {
  try {
    window.localStorage.clear()
  } catch {
    // Storage can be refused outright; the app copes, and so can the test.
  }
  await Promise.all(DATABASES.map(deleteDatabase))
}

/** Pins `Date` and nothing else, so timers, animation frames and `waitFor` keep running. */
export function pinToDemoReference(): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(DEFAULT_DEMO_REFERENCE))
}

export function releaseClock(): void {
  vi.useRealTimers()
}

let mounted: { root: Root; host: HTMLElement } | null = null

/**
 * Mounts the app on the demo profile, once, and waits until it has loaded its nineteen
 * examples. Pair it with `unmountDemoApp` in `beforeAll` and `afterAll`.
 *
 * Once per file rather than once per test, and that is not a saving but a constraint:
 * `vi.resetModules` does nothing in browser mode, so a second mount in the same file would
 * get the first one's backend back, still holding a tracker whose database this function
 * had just emptied, and fail with "removed from this browser". Each test file runs in a page
 * of its own, so the module graph is fresh at the start of a file and storage is cleared
 * there. The tests are layout reads, and the few that change what is on screen (a filter)
 * put it back, so they share one mount without sharing any state that matters.
 *
 * It mounts outside Testing Library's `render` for the same reason: that registers the tree
 * for the `afterEach` cleanup in `setup.browser.ts`, which would unmount the app after the
 * first test and leave the rest measuring an empty page.
 *
 * The clock is the caller's to pin (`pinToDemoReference`) before this, and to release after
 * `unmountDemoApp`: only the test file knows when it is done with it.
 */
export async function mountDemoApp(): Promise<void> {
  await mountApp('demo')
}

/**
 * The same mount on the real tracker's profile, which opens empty: the first visit's screen,
 * and what the topbar looks like once something typed exists only in this browser. The demo
 * never keeps a backlog, so it cannot show either.
 */
export async function mountEmptyApp(): Promise<void> {
  await mountApp('live')
}

async function mountApp(profile: 'demo' | 'live'): Promise<void> {
  await clearStorage()
  // Which tracker opens comes from the URL, so the mount starts on a bare one.
  window.history.replaceState(null, '', '/')
  // Read when asked for, not when a module loads, so a stub here is in time.
  vi.stubEnv('VITE_TRACKER_PROFILE', profile)
  const { default: App } = await import('../App')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted = { root, host }
  root.render(<App />)
  await waitFor(
    () => expect(screen.queryByText('Loading tracker data…')).not.toBeInTheDocument(),
    { timeout: 30_000 },
  )
  // A tracker that failed to load renders a message where the app should be; say so here
  // rather than letting every test below report a missing control.
  expect(screen.queryByText('Could not load tracker data')).not.toBeInTheDocument()
  await screen.findByRole('navigation', { name: 'Tracker views' })
}

export function unmountDemoApp(): void {
  vi.unstubAllEnvs()
  mounted?.root.unmount()
  mounted?.host.remove()
  mounted = null
}

/** Two frames, so a viewport change has reflowed and its media queries have been answered. */
export async function settle(): Promise<void> {
  for (let frame = 0; frame < 2; frame += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}

const TOLERANCE = 1

/**
 * Every box inside `container` that sticks out of it, by more than a pixel of rounding.
 *
 * The assertion behind most of these tests, because it is false for any cause of a card or
 * a cell that overflows: a long name, a control that stopped wrapping, a width that grew
 * from the inside. Boxes with no size are skipped (a hidden label has no edge to stick out),
 * and so is anything `sr-only`, which is a one-pixel clip by design. `skip` names boxes that
 * scroll on purpose: they are themselves checked, what is inside them is not.
 */
export function escapes(container: Element, root: Element = container, skip?: string): string[] {
  const edge = container.getBoundingClientRect()
  const found: string[] = []
  for (const element of root.querySelectorAll('*')) {
    if (element.closest('.sr-only')) continue
    // A box that scrolls on purpose may hold more than it shows; what is inside it is its own.
    if (skip && element.closest(skip) !== null && !element.matches(skip)) continue
    const box = element.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) continue
    if (
      box.left < edge.left - TOLERANCE
      || box.right > edge.right + TOLERANCE
    ) {
      found.push(
        `${element.tagName.toLowerCase()}.${element.className} `
        + `[${Math.round(box.left)}–${Math.round(box.right)}] outside `
        + `[${Math.round(edge.left)}–${Math.round(edge.right)}]`,
      )
    }
  }
  return found
}

/** The page itself must not scroll sideways: a board or a table scrolls inside its own box. */
export function pageScrollsSideways(): boolean {
  return document.documentElement.scrollWidth > document.documentElement.clientWidth + TOLERANCE
}

/**
 * The first ancestor whose edge cuts `element` off, or null. A panel that opens inside a
 * scrolling board is clipped by it however far inside the window it lies, which a check
 * against the window alone cannot see.
 */
export function clippedBy(element: Element): string | null {
  const own = element.getBoundingClientRect()
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor)
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
    const edge = ancestor.getBoundingClientRect()
    if (
      (style.overflowX !== 'visible' && (own.left < edge.left - TOLERANCE || own.right > edge.right + TOLERANCE))
      || (style.overflowY !== 'visible' && (own.top < edge.top - TOLERANCE || own.bottom > edge.bottom + TOLERANCE))
    ) {
      return `${ancestor.tagName.toLowerCase()}.${ancestor.className}`
    }
  }
  return null
}
