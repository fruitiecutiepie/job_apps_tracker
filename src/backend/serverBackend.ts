import { attachmentFileUrl, ATTACHMENTS_URL } from '../domain/attachmentRoutes'
import { ensureFreshIndexes, refreshTrackerDatabase } from '../domain/database'
import { MAX_STAGE_NOTE_BYTES, stageNoteEditUrl } from '../domain/noteEditingPaths'
import type { StageNoteEditContents, StageNoteEditSession } from '../domain/noteEditing'
import type { StateId, TrackerDatabase } from '../domain/types'
import { assertTrackerDocument } from '../domain/validation'
import type { TrackerBackend } from './types'

export const DB_URL = '/__db'

async function failure(response: Response, fallback: string): Promise<never> {
  const message = await response.text()
  throw new Error(message || `${fallback} (${response.status})`)
}

/**
 * The dev server's filesystem routes. This is the behaviour the app has always had; it
 * moved here unchanged so a second implementation could sit beside it.
 */
export function serverBackend(): TrackerBackend {
  return {
    capabilities: { externalEditor: true, connectableStorage: false },

    async loadDocument(): Promise<TrackerDatabase> {
      const response = await fetch(DB_URL)
      if (!response.ok) await failure(response, 'Failed to load tracker data')
      return ensureFreshIndexes(assertTrackerDocument(await response.json()))
    },

    async saveDocument(document: TrackerDatabase): Promise<TrackerDatabase> {
      const refreshed = refreshTrackerDatabase(document)
      const response = await fetch(DB_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refreshed),
      })
      if (!response.ok) await failure(response, 'Failed to save tracker data')
      return assertTrackerDocument(await response.json())
    },

    async resetDocument(): Promise<TrackerDatabase> {
      const response = await fetch(DB_URL, { method: 'DELETE' })
      if (!response.ok) await failure(response, 'Failed to reset tracker data')
      return assertTrackerDocument(await response.json())
    },

    async readAttachment(applicationId: string, attachmentId: string): Promise<Uint8Array | null> {
      const response = await fetch(attachmentFileUrl(applicationId, attachmentId))
      if (!response.ok) return null
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength === 0) return null
      return new Uint8Array(buffer)
    },

    async writeAttachment(
      applicationId: string,
      attachmentId: string,
      file: Blob,
      mime: string | null,
    ): Promise<void> {
      const response = await fetch(attachmentFileUrl(applicationId, attachmentId), {
        method: 'PUT',
        headers: mime ? { 'Content-Type': mime } : {},
        body: file,
      })
      if (!response.ok) await failure(response, 'Failed to upload attachment')
    },

    async deleteAttachment(applicationId: string, attachmentId: string): Promise<void> {
      const response = await fetch(attachmentFileUrl(applicationId, attachmentId), { method: 'DELETE' })
      if (!response.ok && response.status !== 404) {
        await failure(response, 'Failed to delete attachment')
      }
    },

    async deleteApplicationAttachments(applicationId: string): Promise<void> {
      const response = await fetch(`${ATTACHMENTS_URL}/${applicationId}`, { method: 'DELETE' })
      if (!response.ok && response.status !== 404) {
        await failure(response, 'Failed to delete application attachments')
      }
    },

    async wipeAttachments(): Promise<void> {
      const response = await fetch(ATTACHMENTS_URL, { method: 'DELETE' })
      if (!response.ok) await failure(response, 'Failed to wipe attachments')
    },

    async openNoteInEditor(
      applicationId: string,
      state: StateId,
      body: string,
    ): Promise<StageNoteEditSession> {
      if (new TextEncoder().encode(body).length > MAX_STAGE_NOTE_BYTES) {
        throw new TypeError(`Stage note exceeds the ${MAX_STAGE_NOTE_BYTES} byte limit`)
      }
      const response = await fetch(stageNoteEditUrl(applicationId, state), {
        method: 'POST',
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        body,
      })
      if (!response.ok) await failure(response, 'Could not open an editor')
      return (await response.json()) as StageNoteEditSession
    },

    async readNoteFromEditor(
      applicationId: string,
      state: StateId,
    ): Promise<StageNoteEditContents | null> {
      const response = await fetch(stageNoteEditUrl(applicationId, state))
      if (response.status === 404) return null
      if (!response.ok) await failure(response, 'Could not read the edited note')
      return (await response.json()) as StageNoteEditContents
    },

    async closeNoteEditor(applicationId: string, state: StateId): Promise<void> {
      const response = await fetch(stageNoteEditUrl(applicationId, state), { method: 'DELETE' })
      if (!response.ok && response.status !== 404) {
        await failure(response, 'Could not end the editing session')
      }
    },
  }
}
