import {
  packTrackerArchive,
  type ArchiveAttachmentFile,
} from './archive'
import { refreshTrackerDatabase } from './database'
import type { TrackerDatabase } from './types'
import { assertTrackerDocument } from './validation'
import { attachmentFileUrl } from './attachments'

export function serializeTrackerDocument(document: TrackerDatabase): string {
  return `${JSON.stringify(assertTrackerDocument(refreshTrackerDatabase(document)), null, 2)}\n`
}

export function exportFilename(at: Date = new Date(), extension: 'json' | 'zip' = 'zip'): string {
  return `job-applications-${at.toISOString().replace(/[:.]/g, '-')}.${extension}`
}

export async function collectArchiveFiles(document: TrackerDatabase): Promise<ArchiveAttachmentFile[]> {
  const files: ArchiveAttachmentFile[] = []

  for (const application of document.applications) {
    for (const attachment of application.attachments) {
      const response = await fetch(attachmentFileUrl(application.id, attachment.id, attachment.filename))
      if (!response.ok) continue
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength === 0) continue
      files.push({
        applicationId: application.id,
        attachmentId: attachment.id,
        data: new Uint8Array(buffer),
      })
    }
  }

  return files
}

export async function downloadTrackerArchive(document: TrackerDatabase, at: Date = new Date()): Promise<void> {
  const files = await collectArchiveFiles(document)
  const archiveBytes = packTrackerArchive(document, files)
  const blob = new Blob([archiveBytes as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = exportFilename(at, 'zip')
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
