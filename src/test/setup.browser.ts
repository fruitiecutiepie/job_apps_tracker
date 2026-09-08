/**
 * Setup for the browser suite, deliberately not `setup.ts`.
 *
 * Almost everything that file does is a stand-in for something a browser has: it fakes
 * `matchMedia`, stubs `ResizeObserver`, and intercepts `fetch` to keep the tests off the
 * disk. Here the first two are real, and stubbing them would be the one thing that could
 * make this suite pointless — a `matchMedia` reporting light on demand cannot tell you
 * whether a media query applies.
 *
 * What it does carry is the stylesheet. The whole suite measures layout, and without the
 * real CSS there is no layout to measure: every test would pass against a stack of
 * unstyled divs and prove nothing.
 */

import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// The real stylesheet, which is the subject of most of these tests.
import '../styles.css'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  /*
   * No network, at all. These tests mount the panel with stub callbacks and have nothing
   * to load or store, so any request is a mistake — and a mistake worth failing on rather
   * than absorbing. The server behind this suite has no `/__db` handler either, but a
   * request that reached one would be reaching the user's real tracker data, so this says
   * so loudly at the point it happens.
   */
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    throw new Error(
      `The browser suite made a request to ${url}. These tests mount the panel directly and `
      + 'must not talk to a server: the dev server writes the real tracker file.',
    )
  }))
})
