import type { TrackerSummary } from './backend'

/*
 * Where a tracker lives, which is what tells apart two that share a name. A page is never
 * told a path, so this is the nearest the browser lets it say: the folder's name, or the
 * name of the file it was opened from.
 */
export function describeWhere(tracker: Pick<TrackerSummary, 'folder' | 'sourceFile'>): string {
  if (tracker.folder) return `in ${tracker.folder} folder`
  if (tracker.sourceFile) return `from ${tracker.sourceFile}`
  return 'only in this browser'
}
