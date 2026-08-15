import type { TrackerDatabase } from './types'
import { assertTrackerDocument } from './validation'
import { refreshTrackerDatabase } from './database'

export function serializeTrackerDocument(document: TrackerDatabase): string {
  return `${JSON.stringify(assertTrackerDocument(refreshTrackerDatabase(document)), null, 2)}\n`
}

export function exportFilename(at: Date = new Date()): string {
  return `job-applications-${at.toISOString().replace(/[:.]/g, '-')}.json`
}

export function downloadTrackerDocument(document: TrackerDatabase, at: Date = new Date()): void {
  const blob = new Blob([serializeTrackerDocument(document)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = exportFilename(at)
  anchor.click()
  URL.revokeObjectURL(url)
}
