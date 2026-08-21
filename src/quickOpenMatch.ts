/**
 * Matching for the stage picker. Kept apart from the component so it can be tested on
 * its own, and so the component file exports only a component.
 */

/**
 * Scores a label against a query typed in a hurry: the query's characters have to appear
 * in order, but not together, so `oa` finds "Online assessment". A lower score is a
 * better match — an earlier first character, then fewer characters skipped over.
 */
export function fuzzyScore(label: string, query: string): number | null {
  if (!query) return 0

  const haystack = label.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  let at = -1
  let first = -1
  let gaps = 0

  for (const character of needle) {
    const found = haystack.indexOf(character, at + 1)
    if (found === -1) return null
    if (first === -1) first = found
    else gaps += found - at - 1
    at = found
  }

  return first * 100 + gaps
}
