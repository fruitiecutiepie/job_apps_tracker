import {
  MAX_ATTACHMENT_BYTES,
  isSafeAttachmentId,
} from './attachmentPaths'
import { saveTrackerDatabase } from './storage'
import type { TrackerDatabase } from './types'

export const ATTACHMENTS_URL = '/__attachments'

export function attachmentFileUrl(
  applicationId: string,
  attachmentId: string,
  filename?: string,
): string {
  const base = `${ATTACHMENTS_URL}/${applicationId}/${attachmentId}`
  if (!filename) return base
  return `${base}?filename=${encodeURIComponent(filename)}`
}

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

  const response = await fetch(attachmentFileUrl(applicationId, attachmentId), {
    method: 'PUT',
    headers: mime ? { 'Content-Type': mime } : {},
    body: file,
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Failed to upload attachment (${response.status})`)
  }
}

export async function deleteAttachmentFile(applicationId: string, attachmentId: string): Promise<void> {
  const response = await fetch(attachmentFileUrl(applicationId, attachmentId), { method: 'DELETE' })
  if (!response.ok && response.status !== 404) {
    const message = await response.text()
    throw new Error(message || `Failed to delete attachment (${response.status})`)
  }
}

export async function deleteApplicationAttachmentFolder(applicationId: string): Promise<void> {
  const response = await fetch(`${ATTACHMENTS_URL}/${applicationId}`, { method: 'DELETE' })
  if (!response.ok && response.status !== 404) {
    const message = await response.text()
    throw new Error(message || `Failed to delete application attachments (${response.status})`)
  }
}

export async function wipeAllAttachmentFiles(): Promise<void> {
  const response = await fetch(ATTACHMENTS_URL, { method: 'DELETE' })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Failed to wipe attachments (${response.status})`)
  }
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
  const response = await fetch(attachmentFileUrl(applicationId, attachmentId, filename))
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Failed to open attachment (${response.status})`)
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}
