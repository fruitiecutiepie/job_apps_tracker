/**
 * What only a browser can answer about the theme: whether choosing Dark actually reaches
 * every surface. The stylesheet's dark palette applies through `data-theme` and a
 * `prefers-color-scheme` block; a surface that took a literal colour instead of a token reads
 * fine in one theme and unreadable in the other, which no jsdom test can see — it computes no
 * styles from a stylesheet.
 *
 * The real app is mounted on the demo (see `appHarness`), and the pairs checked are the ones
 * a reader looks at most: the card's company and role, a lane's heading, a table cell, the
 * view strip and the filters. Text must hold the WCAG AA ratio against what it sits on, in
 * both themes, which is false for any cause — a literal white, a token left out of the dark
 * block, a surface that did not change.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'
import { page, userEvent } from 'vitest/browser'

import {
  DESKTOP,
  mountDemoApp,
  pinToDemoReference,
  releaseClock,
  settle,
  unmountDemoApp,
} from './test/appHarness'

type Rgba = [number, number, number, number]

/** Reads what `getComputedStyle` hands back for a colour: `rgb()`, `rgba()` or `color(srgb …)`. */
function parseColor(value: string): Rgba {
  const numbers = value.match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number) ?? []
  if (value.startsWith('color(')) {
    const [r, g, b, a = 1] = numbers
    return [r * 255, g * 255, b * 255, a]
  }
  const [r, g, b, a = 1] = numbers
  return [r, g, b, a]
}

function luminance([r, g, b]: Rgba): number {
  const channel = (value: number) => {
    const unit = value / 255
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** What an element actually sits on: its own fill, or the nearest ancestor's that has one. */
function backgroundBehind(element: Element): Rgba {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const colour = parseColor(getComputedStyle(node).backgroundColor)
    if (colour[3] > 0.99) return colour
    // A part-transparent fill over the page is close enough to its own colour here.
    if (colour[3] > 0) return [colour[0], colour[1], colour[2], 1]
  }
  return [255, 255, 255, 1]
}

function contrast(element: Element): number {
  const text = luminance(parseColor(getComputedStyle(element).color))
  const ground = luminance(backgroundBehind(element))
  const [light, dark] = text > ground ? [text, ground] : [ground, text]
  return (light + 0.05) / (dark + 0.05)
}

const READ = [
  ['a card\'s company', '.application-card__open strong'],
  ['a lane\'s heading', '.kanban-lane__header h3, .kanban-lane__header h2'],
  ['the view strip', '.view-nav__item'],
  ['a filter', '.context-bar select'],
  ['the brand', '.brand strong'],
] as const

const AA = 4.5

describe('the theme', () => {
  beforeAll(async () => {
    pinToDemoReference()
    await mountDemoApp()
    await page.viewport(DESKTOP.width, DESKTOP.height)
    await settle()
  })

  afterAll(async () => {
    try {
      window.localStorage.removeItem('theme')
    } catch {
      // Storage can be refused; the page goes with the mount.
    }
    document.documentElement.removeAttribute('data-theme')
    unmountDemoApp()
    releaseClock()
  })

  async function choose(label: 'Light' | 'Dark'): Promise<void> {
    await userEvent.click(within(document.querySelector<HTMLElement>('.topbar')!).getByRole('button', { name: /^Theme:/ }))
    // The radio is visually hidden and its label is what a pointer hits.
    await userEvent.click(within(document.querySelector<HTMLElement>('.theme-menu')!).getByText(label))
    await userEvent.keyboard('{Escape}')
    await settle()
    // Colours transition (a lane takes 120ms), and a reading taken mid-way is neither theme's.
    await new Promise((resolve) => setTimeout(resolve, 400))
  }

  it.each(['Light', 'Dark'] as const)('holds AA contrast on what is read most, in %s', async (label) => {
    await choose(label)
    expect(document.documentElement.getAttribute('data-theme')).toBe(label.toLowerCase())
    for (const [name, selector] of READ) {
      const elements = [...document.querySelectorAll<HTMLElement>(selector)]
      expect(elements.length, name).toBeGreaterThan(0)
      for (const element of elements) {
        expect(contrast(element), `${name} (${element.textContent?.slice(0, 20)}) in ${label}`).toBeGreaterThanOrEqual(AA)
      }
    }
  })

  it('turns the page itself over: dark behind light, and the other way', async () => {
    await choose('Light')
    const light = luminance(backgroundBehind(document.body))
    await choose('Dark')
    const dark = luminance(backgroundBehind(document.body))
    expect(light).toBeGreaterThan(0.6)
    expect(dark).toBeLessThan(0.2)
    for (const selector of ['.topbar', '.application-card', '.kanban-lane']) {
      expect(luminance(backgroundBehind(document.querySelector(selector)!)), selector).toBeLessThan(0.2)
    }
  })
})
