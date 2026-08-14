import type { TrackerDocument } from './types'
import { assertTrackerDocument } from './validation'

export function serializeTrackerDocument(document: TrackerDocument): string {
  return `${JSON.stringify(assertTrackerDocument(document), null, 2)}\n`
}

export function exportFilename(at: Date = new Date()): string {
  return `job-applications-${at.toISOString().replace(/[:.]/g, '-')}.json`
}

export function downloadTrackerDocument(document: TrackerDocument, at: Date = new Date()): void {
  const blob = new Blob([serializeTrackerDocument(document)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = exportFilename(at)
  anchor.click()
  URL.revokeObjectURL(url)
}
