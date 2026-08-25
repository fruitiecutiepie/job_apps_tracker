/**
 * Where a stage note's reading area begins, and which heading is at the top of it.
 *
 * Both answers come from measuring the sticky header rather than doing arithmetic on a
 * constant. An earlier version added up a hardcoded 49px header and the pane's border and
 * still landed 16px high, because the pane's own padding sits between them and a sticky
 * offset resolves against the content edge. The header's bottom edge already is that line,
 * so measuring it needs no constants and survives the header wrapping to two rows.
 */

/** The pane's sticky stage header, whose bottom edge note content sits below. */
const HEADER_SELECTOR = '.stage-note__header'

/**
 * A heading pinned by `position: sticky` sits exactly on the line, and sub-pixel rounding
 * can put it a hair either side. Without this tolerance a pinned heading reads as "not yet
 * reached" and the outline marks the section above the one being read.
 */
const STICKY_EPSILON_PX = 1.5

/**
 * The line note content sits below, in viewport units.
 *
 * That is the stage header, plus any level 1/2 heading currently pinned beneath it: those
 * are opaque and painted above the note, so a heading level with them is covered even
 * though nothing is technically overlapping the header. `exclude` leaves the heading being
 * jumped to out of that reckoning, so it is not asked to clear itself.
 */
export function readingTopLine(container: HTMLElement, exclude?: Element | null): number {
  const header = container.querySelector<HTMLElement>(HEADER_SELECTOR)
  const headerLine = header
    ? header.getBoundingClientRect().bottom
    : // No header rendered yet — fall back to the pane's own content edge.
      container.getBoundingClientRect().top + container.clientTop

  let line = headerLine
  for (const heading of container.querySelectorAll<HTMLElement>('[data-section-key]')) {
    if (heading === exclude) continue
    const rect = heading.getBoundingClientRect()
    // Only a heading sitting exactly on the line is pinned there. Testing the rect first
    // keeps getComputedStyle off every heading in the note on every scroll frame.
    if (Math.abs(rect.top - headerLine) > STICKY_EPSILON_PX) continue
    if (getComputedStyle(heading).position !== 'sticky') continue
    line = Math.max(line, rect.bottom)
  }
  return line
}

/**
 * The last heading scrolled past in `container`, or null when none has been.
 *
 * Scans every heading rather than stopping at the first one below the line: a sticky
 * heading pins *down* to the line while the content after it scrolls *up* past it, so
 * heading positions do not run in document order and an early break stops one short.
 */
export function headingAtScrollTop(container: HTMLElement): string | null {
  const limit = readingTopLine(container) + STICKY_EPSILON_PX

  let found: string | null = null
  for (const heading of container.querySelectorAll<HTMLElement>('[data-section-key]')) {
    if (heading.getBoundingClientRect().top <= limit) found = heading.dataset.sectionKey ?? null
  }
  return found
}
