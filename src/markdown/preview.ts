/**
 * One line of what something holds, for a row that has folded it away.
 *
 * Its own module rather than a helper inside the renderer, because the editor's message rows
 * fold too and have to cut at the same place: a preview that said more in one surface than
 * the other would read as two different summaries of the same message. A component file also
 * cannot export it without the whole file losing Fast Refresh.
 */
export function preview(text: string, limit = 48): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > limit ? `${collapsed.slice(0, limit).trimEnd()}…` : collapsed
}
