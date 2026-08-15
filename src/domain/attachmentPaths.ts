/** Safe identifier for application and attachment ids (UUID-shaped tokens). */
export const SAFE_ATTACHMENT_ID = /^[0-9a-f-]{36}$/i

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

export const TRACKER_ARCHIVE_JSON = 'tracker.json'
export const ATTACHMENTS_ARCHIVE_PREFIX = 'attachments/'

export function isSafeAttachmentId(value: string): boolean {
  return SAFE_ATTACHMENT_ID.test(value)
}

export function safeAttachmentFilename(value: string): string {
  const basename = value.split(/[/\\]/).pop() ?? ''
  const trimmed = basename.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    throw new TypeError('Filename is invalid')
  }
  return trimmed
}

export function isSafeArchiveAttachmentPath(entryPath: string): { applicationId: string; attachmentId: string } | null {
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized.includes('..')) return null

  const match = /^attachments\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i.exec(normalized)
  if (!match) return null

  const applicationId = match[1]!
  const attachmentId = match[2]!
  if (!isSafeAttachmentId(applicationId) || !isSafeAttachmentId(attachmentId)) return null
  return { applicationId, attachmentId }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
