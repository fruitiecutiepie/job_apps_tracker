import {
  ATTACHMENTS_ARCHIVE_PREFIX,
  isSafeAttachmentId,
  TRACKER_ARCHIVE_JSON,
  isSafeArchiveAttachmentPath,
} from './attachmentPaths'
import { serializeTrackerDocument } from './export'
import type { TrackerDatabase } from './types'
import { parseTrackerDocument } from './validation'
import { zipSync, unzipSync } from 'fflate'

export interface ArchiveAttachmentFile {
  applicationId: string
  attachmentId: string
  data: Uint8Array
}

export function archiveAttachmentPath(applicationId: string, attachmentId: string): string {
  return `${ATTACHMENTS_ARCHIVE_PREFIX}${applicationId}/${attachmentId}`
}

export function packTrackerArchive(
  document: TrackerDatabase,
  files: ArchiveAttachmentFile[],
): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    [TRACKER_ARCHIVE_JSON]: new TextEncoder().encode(serializeTrackerDocument(document)),
  }

  for (const file of files) {
    if (!isSafeAttachmentId(file.applicationId) || !isSafeAttachmentId(file.attachmentId)) {
      throw new TypeError('Archive attachment ids are invalid')
    }
    if (file.data.length === 0) throw new TypeError('Archive attachment data must not be empty')
    entries[archiveAttachmentPath(file.applicationId, file.attachmentId)] = file.data
  }

  return zipSync(entries)
}

export function unpackTrackerArchive(bytes: Uint8Array): {
  document: TrackerDatabase
  files: ArchiveAttachmentFile[]
} {
  const entries = unzipSync(bytes)
  const trackerEntry = entries[TRACKER_ARCHIVE_JSON]
  if (!trackerEntry) throw new TypeError('Archive is missing tracker.json')

  const document = parseTrackerDocument(new TextDecoder().decode(trackerEntry))
  const files: ArchiveAttachmentFile[] = []

  for (const [entryPath, data] of Object.entries(entries)) {
    if (entryPath === TRACKER_ARCHIVE_JSON) continue
    const parsed = isSafeArchiveAttachmentPath(entryPath)
    if (!parsed) continue
    if (data.length === 0) throw new TypeError(`Archive entry ${entryPath} is empty`)
    files.push({
      applicationId: parsed.applicationId,
      attachmentId: parsed.attachmentId,
      data,
    })
  }

  return { document, files }
}

export function isZipArchive(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

export async function readFileAsUint8Array(file: Blob): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer()
  return new Uint8Array(buffer)
}
