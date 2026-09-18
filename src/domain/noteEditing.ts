import { backend } from '../backend'
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

/** Whether this build can hand a note to an editor at all. False in the static build. */
export function supportsExternalEditor(): boolean {
  return backend.capabilities.externalEditor
}

function unsupported(): never {
  throw new Error('This build cannot open an external editor')
}

/** Writes the stage note to a scratch file and hands it to the configured editor. */
export function openStageNoteInEditor(
  applicationId: string,
  state: StateId,
  body: string,
): Promise<StageNoteEditSession> {
  if (!backend.openNoteInEditor) unsupported()
  return backend.openNoteInEditor(applicationId, state, body)
}

/** Reads the scratch file back, or null when the session is gone. */
export function readStageNoteFromEditor(
  applicationId: string,
  state: StateId,
): Promise<StageNoteEditContents | null> {
  if (!backend.readNoteFromEditor) unsupported()
  return backend.readNoteFromEditor(applicationId, state)
}

export function closeStageNoteEditor(applicationId: string, state: StateId): Promise<void> {
  if (!backend.closeNoteEditor) unsupported()
  return backend.closeNoteEditor(applicationId, state)
}
