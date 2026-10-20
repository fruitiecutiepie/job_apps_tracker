/**
 * A real finger, for the browser suite.
 *
 * Synthetic `PointerEvent`s reach a page's listeners and nothing else: the browser never
 * sees a touch, so it never decides to scroll, never cancels the pointer to do so, and
 * never shows a long-press menu. Those are exactly the things that broke dragging on a
 * phone while the synthetic tests passed. This drives Chromium's own touch input over the
 * DevTools protocol instead, so the page receives what a phone sends — touch events and
 * pointer events both, with the browser's scrolling decided in between.
 *
 * Chromium only: Firefox and WebKit offer no such channel through Playwright. Tests using
 * this say so with `runIf(server.browser === 'chromium')`.
 */

import { cdp } from 'vitest/browser'
// The provider's types are what give the session its `send`.
import type {} from '@vitest/browser-playwright'

export interface Point {
  x: number
  y: number
}

export function centre(element: Element): Point {
  const box = element.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

/*
 * The test runs in an iframe that the runner draws scaled down inside its own page, and
 * the protocol speaks in that outer page's coordinates.
 */
function toPage(point: Point) {
  const frame = window.frameElement?.getBoundingClientRect()
  if (!frame) return point
  const scale = frame.width / window.innerWidth
  return { x: frame.left + point.x * scale, y: frame.top + point.y * scale }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let enabled = false

/**
 * Puts a finger down at the first point, holds it there for `holdMs`, slides it through
 * the rest, rests on the last for `dwellMs`, and lifts it.
 */
export async function touch(
  path: Point[],
  { holdMs = 0, dwellMs = 0, steps = 12, stepMs = 16 }: {
    holdMs?: number
    dwellMs?: number
    steps?: number
    stepMs?: number
  } = {},
) {
  const session = cdp()
  if (!enabled) {
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    enabled = true
  }
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', point?: Point) =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: point ? [{ ...toPage(point), id: 1 }] : [],
    })

  await send('touchStart', path[0])
  await wait(holdMs)
  for (let leg = 1; leg < path.length; leg += 1) {
    const from = path[leg - 1]
    const to = path[leg]
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps
      await send('touchMove', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
      await wait(stepMs)
    }
  }
  await wait(dwellMs)
  await send('touchEnd')
  // Let the click a tap produces, and the render a drop causes, arrive.
  await wait(100)
}
