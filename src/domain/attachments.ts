import { backend } from '../backend'
import {
  MAX_ATTACHMENT_BYTES,
  isSafeAttachmentId,
} from './attachmentPaths'
import { saveTrackerDatabase } from './storage'
import type { TrackerDatabase } from './types'


export async function uploadAttachmentFile(
  applicationId: string,
  attachmentId: string,
  file: Blob,
  mime: string | null,
): Promise<void> {
  if (!isSafeAttachmentId(applicationId) || !isSafeAttachmentId(attachmentId)) {
    throw new TypeError('Attachment ids are invalid')
  }
  if (file.size === 0) throw new TypeError('Attachment file must not be empty')
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new TypeError(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte limit`)
  }

  await backend.writeAttachment(applicationId, attachmentId, file, mime)
}

export async function deleteAttachmentFile(applicationId: string, attachmentId: string): Promise<void> {
  await backend.deleteAttachment(applicationId, attachmentId)
}

export async function deleteApplicationAttachmentFolder(applicationId: string): Promise<void> {
  await backend.deleteApplicationAttachments(applicationId)
}

export async function wipeAllAttachmentFiles(): Promise<void> {
  await backend.wipeAttachments()
}

export async function importTrackerArchive(
  document: TrackerDatabase,
  files: Array<{ applicationId: string; attachmentId: string; data: Uint8Array }>,
): Promise<TrackerDatabase> {
  await wipeAllAttachmentFiles()
  const saved = await saveTrackerDatabase(document)
  for (const file of files) {
    await uploadAttachmentFile(
      file.applicationId,
      file.attachmentId,
      new Blob([file.data as BlobPart]),
      null,
    )
  }
  return saved
}

export async function openAttachmentFile(
  applicationId: string,
  attachmentId: string,
  filename: string,
): Promise<void> {
  const bytes = await backend.readAttachment(applicationId, attachmentId)
  if (!bytes) throw new Error('Failed to open attachment')
  const objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart]))
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}
