import {
  packTrackerArchive,
  type ArchiveAttachmentFile,
} from './archive'
import { refreshTrackerDatabase } from './database'
import type { TrackerDatabase } from './types'
import { assertTrackerDocument } from './validation'
import { backend } from '../backend'

export function serializeTrackerDocument(document: TrackerDatabase): string {
  return `${JSON.stringify(assertTrackerDocument(refreshTrackerDatabase(document)), null, 2)}\n`
}

/*
 * Named after the tracker and the day, so a folder of exports says what each one is and
 * an import can name the tracker it makes back from it. Characters no filesystem takes in
 * a name are replaced; the day is the local one, which is the day the reader thinks it is.
 */
export function exportFilename(
  at: Date = new Date(),
  extension: 'json' | 'zip' = 'zip',
  name = 'job-applications',
): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'job-applications'
  const day = [
    at.getFullYear(),
    String(at.getMonth() + 1).padStart(2, '0'),
    String(at.getDate()).padStart(2, '0'),
  ].join('-')
  return `${safe} ${day}.${extension}`
}

export async function collectArchiveFiles(document: TrackerDatabase): Promise<ArchiveAttachmentFile[]> {
  const files: ArchiveAttachmentFile[] = []

  for (const application of document.applications) {
    for (const attachment of application.attachments) {
      const data = await backend.readAttachment(application.id, attachment.id)
      // A metadata row whose bytes are gone should not fail the whole export.
      if (!data || data.byteLength === 0) continue
      files.push({ applicationId: application.id, attachmentId: attachment.id, data })
    }
  }

  return files
}

export async function downloadTrackerArchive(
  document: TrackerDatabase,
  at: Date = new Date(),
  name?: string,
): Promise<void> {
  const files = await collectArchiveFiles(document)
  const archiveBytes = packTrackerArchive(document, files)
  const blob = new Blob([archiveBytes as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = exportFilename(at, 'zip', name)
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadTrackerDocument(document: TrackerDatabase, at: Date = new Date()): void {
  const blob = new Blob([serializeTrackerDocument(document)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = exportFilename(at, 'json')
  anchor.click()
  URL.revokeObjectURL(url)
}
