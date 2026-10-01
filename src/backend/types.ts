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
  /**
   * Applies a mutation to the newest stored document and stores the result. Present where
   * more than one tab can write the same document: the mutation is run on whatever another
   * tab last stored rather than on `current`, which may be behind it, so two tabs editing
   * at once both keep their edits. `wrote` is false when the mutation had nothing to do.
   */
  updateDocument?(
    current: TrackerDatabase,
    mutate: (document: TrackerDatabase) => TrackerDatabase,
  ): Promise<{ document: TrackerDatabase; wrote: boolean }>
  /** Hears about changes another tab made to this tab's tracker. */
  subscribeChanges?(listener: (change: ExternalChange) => void): () => void
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

export type ExternalChange =
  /** Another tab stored a newer document for this tracker. */
  | { kind: 'document'; document: TrackerDatabase }
  /** Another tab removed this tracker; `next` is the one it opened instead. */
  | { kind: 'removed'; next: TrackerSummary | null }

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
 * One tracker among the several a browser can hold. The static build keeps each under an
 * id of its own, so two tabs can have two different trackers open — a folder in one, an
 * imported file in the other — without either writing over the other.
 */
export interface TrackerSummary {
  id: string
  /** The connected folder's name, else the imported file's, else a placeholder. */
  name: string
  applications: number
  /** When a tab last opened it: a new tab opens the most recent. */
  openedAt: string
}

/**
 * Where the data is going, and whether any of it exists only in this browser.
 *
 * `unbackedSince` is when the first change not yet in a file the viewer holds was made:
 * written while no folder was reaching it, and not since exported. It is stored, not
 * derived per session, because forgetting to export is something that happens across
 * visits — a reminder that reset on every reload would say "nothing to worry about" to
 * someone who has been typing into one browser for a month. Always null while connected,
 * where every write reaches the folder, and on the demo, whose data is fictional.
 *
 * `tracker` is null only until the backend has worked out which tracker this tab holds.
 */
export interface StorageState {
  connection: StorageConnection
  unbackedSince: string | null
  tracker: { id: string; name: string } | null
}

export type ConnectResult =
  | { outcome: 'connected'; connection: StorageConnection }
  /** The viewer dismissed the picker. Nothing changed, so there is nothing to report. */
  | { outcome: 'dismissed' }
  /**
   * The folder picked is already another tracker's. Connecting it here too would leave
   * two trackers writing whole documents into one file, each undoing the other, so the
   * caller should open that tracker instead.
   */
  | { outcome: 'already-open'; tracker: TrackerSummary }

export interface ConnectableStorage {
  connection(): StorageConnection
  state(): StorageState
  /** Opens the picker. Must be called from a user gesture. */
  connect(): Promise<ConnectResult>
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
  /**
   * Names this tracker after the file it was imported from. Ignored while a folder is
   * connected, whose name is the one that says where the data is.
   */
  nameAfterFile(filename: string): Promise<void>
  /** Every tracker this browser holds, most recently opened first. */
  listTrackers(): Promise<TrackerSummary[]>
  /**
   * Deletes this tab's tracker from browser storage — never a connected folder's files,
   * which are the viewer's — and returns the tracker to open next, or null for none.
   */
  removeTracker(): Promise<TrackerSummary | null>
  /** Fires whenever the connection, the backlog or the tracker changes. */
  subscribe(listener: (state: StorageState) => void): () => void
}
