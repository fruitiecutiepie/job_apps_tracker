/**
 * Where a stage note's reading area begins, and which heading is at the top of it.
 *
 * Measured off the box that scrolls rather than worked out from a constant. Two earlier
 * versions added a hardcoded header height to the container's top and landed 2px and then
 * 16px out, because the border and the padding sit in that gap as well and a sticky offset
 * resolves against the content edge, past both.
 */

/**
 * A heading pinned by `position: sticky` sits exactly on the line, and sub-pixel rounding
 * can put it a hair either side. Without this tolerance a pinned heading reads as "not yet
 * reached" and the outline marks the section above the one being read.
 */
const STICKY_EPSILON_PX = 1.5

/**
 * The line note content sits below, in viewport units.
 *
 * The top of the scrolling box, past its border and padding, which is where a sticky
 * heading pins. Extended past any heading currently pinned there: those are opaque and
 * painted over the note, so a heading level with one is covered even though it has
 * cleared the top. `exclude` leaves the heading being jumped to out of that reckoning, so
 * it is never asked to clear itself.
 */
export function readingTopLine(container: HTMLElement, exclude?: Element | null): number {
  const styles = getComputedStyle(container)
  const contentTop =
    container.getBoundingClientRect().top
    + container.clientTop
    + parseFloat(styles.paddingTop || '0')

  let line = contentTop
  for (const heading of container.querySelectorAll<HTMLElement>('[data-section-key]')) {
    if (heading === exclude) continue
    const rect = heading.getBoundingClientRect()
    // Only a heading sitting exactly on the line is pinned there. Testing the rect first
    // keeps getComputedStyle off every heading in the note on every scroll frame.
    if (Math.abs(rect.top - contentTop) > STICKY_EPSILON_PX) continue
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
