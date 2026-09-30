import type { StageNoteEditContents, StageNoteEditSession } from '../domain/noteEditing'
import type { TrackerDatabase } from '../domain/types'
import type { StateId } from '../domain/types'

/**
 * What the app needs from whatever is holding the data. Two implementations ship: the
 * dev server's filesystem routes, and a browser-only one for the static build. The shape
 * is deliberately the union of the three route families the dev server already serves,
 * so moving a call from `fetch` to here changed no behaviour.
 */
export interface TrackerBackend {
  readonly capabilities: BackendCapabilities

  loadDocument(): Promise<TrackerDatabase>
  saveDocument(document: TrackerDatabase): Promise<TrackerDatabase>
  resetDocument(): Promise<TrackerDatabase>

  /** Null rather than throwing when the file is simply not there. */
  readAttachment(applicationId: string, attachmentId: string): Promise<Uint8Array | null>
  writeAttachment(
    applicationId: string,
    attachmentId: string,
    file: Blob,
    mime: string | null,
  ): Promise<void>
  deleteAttachment(applicationId: string, attachmentId: string): Promise<void>
  deleteApplicationAttachments(applicationId: string): Promise<void>
  wipeAttachments(): Promise<void>

  /* Present only when `capabilities.externalEditor` is true. */
  openNoteInEditor?(applicationId: string, state: StateId, body: string): Promise<StageNoteEditSession>
  readNoteFromEditor?(applicationId: string, state: StateId): Promise<StageNoteEditContents | null>
  closeNoteEditor?(applicationId: string, state: StateId): Promise<void>

  /* Present only when `capabilities.connectableStorage` is true. */
  storage?: ConnectableStorage
}

export interface BackendCapabilities {
  /** Whether a stage note can be handed to an editor process on this machine. */
  externalEditor: boolean
  /** Whether the viewer chooses where their data lives, and can connect or disconnect it. */
  connectableStorage: boolean
}

export type StorageConnection =
  /** The browser has no File System Access API: the IndexedDB copy is all there is. */
  | { kind: 'unsupported' }
  /** Supported, but nothing has been connected yet. */
  | { kind: 'disconnected' }
  /** A folder was connected before but its permission needs a gesture to renew. */
  | { kind: 'needs-permission'; name: string }
  | { kind: 'connected'; name: string }

/**
 * Where the data is going, and whether any of it exists only in this browser.
 *
 * `unbackedSince` is when the first change not yet in a file the viewer holds was made:
 * written while no folder was reaching it, and not since exported. It is stored, not
 * derived per session, because forgetting to export is something that happens across
 * visits — a reminder that reset on every reload would say "nothing to worry about" to
 * someone who has been typing into one browser for a month. Always null while connected,
 * where every write reaches the folder, and on the demo, whose data is fictional.
 */
export interface StorageState {
  connection: StorageConnection
  unbackedSince: string | null
}

export interface ConnectableStorage {
  connection(): StorageConnection
  state(): StorageState
  /**
   * Opens the picker. Must be called from a user gesture. Null when the viewer dismissed
   * it, which is a decision rather than a result: nothing changed, and a caller that read
   * the unchanged connection as an answer would report a folder nobody picked.
   */
  connect(): Promise<StorageConnection | null>
  /** Re-asks for permission on the folder already stored. Must be called from a gesture. */
  reconnect(): Promise<StorageConnection>
  disconnect(): Promise<StorageConnection>
  /**
   * Records that the viewer now holds a file with everything in it — an export, or an
   * import of the file they already had. Runs behind any write already queued, so an
   * import's own save lands first rather than starting a backlog straight after this
   * cleared it.
   */
  markBackedUp(): Promise<void>
  /** Fires whenever the connection or the backlog changes, so the UI can follow it. */
  subscribe(listener: (state: StorageState) => void): () => void
}
