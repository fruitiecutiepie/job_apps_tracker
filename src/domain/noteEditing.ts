import { MAX_STAGE_NOTE_BYTES, stageNoteEditUrl } from './noteEditingPaths'
import type { StateId } from './types'

export interface StageNoteEditSession {
  /** Repository-relative path of the scratch file, shown so the note stays reachable by hand. */
  path: string
  /** Absolute path on the machine running the dev server, for opening it by hand. */
  absolute_path: string
  /** Command that was launched, or the scheme of the URL handed to the browser. */
  editor: string
  source: 'env' | 'os' | 'url'
  /** When set, the browser opens this so an editor on this machine handles the file. */
  open_url?: string
  /** Set when the file was opened on a different machine from this browser. */
  host?: string
}

export interface StageNoteEditContents {
  body: string
  modified_at: number
}

/** Writes the stage note to a scratch file and hands it to the configured editor. */
export async function openStageNoteInEditor(
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
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Could not open an editor (${response.status})`)
  }
  return (await response.json()) as StageNoteEditSession
}

/** Reads the scratch file back, or null when the session is gone. */
export async function readStageNoteFromEditor(
  applicationId: string,
  state: StateId,
): Promise<StageNoteEditContents | null> {
  const response = await fetch(stageNoteEditUrl(applicationId, state))
  if (response.status === 404) return null
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Could not read the edited note (${response.status})`)
  }
  return (await response.json()) as StageNoteEditContents
}

export async function closeStageNoteEditor(applicationId: string, state: StateId): Promise<void> {
  const response = await fetch(stageNoteEditUrl(applicationId, state), { method: 'DELETE' })
  if (!response.ok && response.status !== 404) {
    const message = await response.text()
    throw new Error(message || `Could not end the editing session (${response.status})`)
  }
}
