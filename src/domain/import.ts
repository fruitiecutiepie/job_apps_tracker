import {
  isZipArchive,
  unpackTrackerArchive,
  type ArchiveAttachmentFile,
} from './archive'
import type { TrackerDatabase } from './types'
import { validateTrackerDocument, type ValidationError } from './validation'

export interface TrackerImportSuccess {
  ok: true
  document: TrackerDatabase
  /** Empty for a plain JSON import, which carries no attachment bytes. */
  files: ArchiveAttachmentFile[]
  format: 'zip' | 'json'
}

export interface TrackerImportFailure {
  ok: false
  errors: ValidationError[]
}

export type TrackerImportResult = TrackerImportSuccess | TrackerImportFailure

/**
 * Turns the bytes of a dropped, pasted or chosen file into a validated document.
 *
 * Everything that can be wrong with a file is wrong here rather than at the call sites:
 * not JSON, not a zip, a zip with no tracker in it, a document that parses but breaks an
 * invariant. The three ways a file reaches the app differ only in how the bytes arrive,
 * so they should differ only in that.
 *
 * It returns failures rather than throwing because an invalid file is an ordinary thing
 * for someone to hand us — a hand-edited export, the wrong file from a Downloads folder —
 * and the caller has to put the reason on screen either way.
 */
export function readTrackerImport(bytes: Uint8Array): TrackerImportResult {
  if (bytes.byteLength === 0) {
    return { ok: false, errors: [{ path: '$', message: 'the file is empty' }] }
  }

  if (isZipArchive(bytes)) {
    let unpacked: { document: TrackerDatabase; files: ArchiveAttachmentFile[] }
    try {
      unpacked = unpackTrackerArchive(bytes)
    } catch (error) {
      return { ok: false, errors: [{ path: '$', message: messageOf(error) }] }
    }
    return { ok: true, document: unpacked.document, files: unpacked.files, format: 'zip' }
  }

  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    return {
      ok: false,
      errors: [{ path: '$', message: 'this is not a tracker export — it is neither JSON nor a zip archive' }],
    }
  }

  const validated = validateTrackerDocument(value)
  if (!validated.ok) return { ok: false, errors: validated.errors }
  return { ok: true, document: validated.value, files: [], format: 'json' }
}

/** The first few problems, for a notice that has one line to say them in. */
export function describeImportErrors(errors: ValidationError[], limit = 3): string {
  if (errors.length === 0) return 'the file could not be read'
  const shown = errors
    .slice(0, limit)
    .map(({ path, message }) => (path === '$' ? message : `${path}: ${message}`))
    .join('; ')
  const rest = errors.length - limit
  return rest > 0 ? `${shown} (and ${rest} more)` : shown
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
