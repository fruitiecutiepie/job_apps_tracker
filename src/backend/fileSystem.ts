/**
 * The File System Access API, narrowed to what the folder mirror uses. Declared here
 * rather than taken from `lib.dom` because `showDirectoryPicker` and the permission
 * methods are not in every TypeScript DOM lib, and because a narrow interface is what
 * lets the tests hand the backend a fake folder.
 */
export interface FileHandleLike {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
  createWritable(): Promise<WritableStreamLike>
}

export interface WritableStreamLike {
  write(data: BufferSource | Blob | string): Promise<void>
  close(): Promise<void>
}

export interface DirectoryHandleLike {
  readonly kind: 'directory'
  readonly name: string
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  keys(): AsyncIterableIterator<string>
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

interface PickerWindow {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike>
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function'
}

export async function pickDirectory(): Promise<DirectoryHandleLike | null> {
  const picker = (window as PickerWindow).showDirectoryPicker
  if (!picker) throw new Error('This browser cannot open a folder')
  try {
    return await picker({ mode: 'readwrite' })
  } catch (error) {
    // Dismissing the picker is a decision, not a failure.
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
}

/**
 * A handle stored in IndexedDB comes back with its permission in whatever state the
 * browser left it. `prompt` can only be cleared from a user gesture, so callers that are
 * not in one must treat it as "not now" rather than asking.
 */
export async function permissionFor(
  handle: DirectoryHandleLike,
  ask: boolean,
): Promise<PermissionState> {
  const descriptor = { mode: 'readwrite' } as const
  const current = (await handle.queryPermission?.(descriptor)) ?? 'granted'
  if (current === 'granted' || !ask) return current
  return (await handle.requestPermission?.(descriptor)) ?? 'denied'
}

export async function readFileIn(
  directory: DirectoryHandleLike,
  name: string,
): Promise<File | null> {
  try {
    return await (await directory.getFileHandle(name)).getFile()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

export async function writeFileIn(
  directory: DirectoryHandleLike,
  name: string,
  data: BufferSource | Blob | string,
): Promise<void> {
  const writable = await (await directory.getFileHandle(name, { create: true })).createWritable()
  try {
    await writable.write(data)
  } finally {
    await writable.close()
  }
}

export async function removeEntryIn(
  directory: DirectoryHandleLike,
  name: string,
  recursive = false,
): Promise<void> {
  try {
    await directory.removeEntry(name, { recursive })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return
    throw error
  }
}

export async function subdirectory(
  directory: DirectoryHandleLike,
  name: string,
  create: boolean,
): Promise<DirectoryHandleLike | null> {
  try {
    return await directory.getDirectoryHandle(name, { create })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}
