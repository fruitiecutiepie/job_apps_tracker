import type { DirectoryHandleLike, FileHandleLike, WritableStreamLike } from './fileSystem'

/**
 * An in-memory folder that behaves the way the File System Access API does, including its
 * `NotFoundError` and its permission states. Tests use it so the backend can be driven
 * without a browser and without a polyfill.
 */
export class FakeDirectory implements DirectoryHandleLike {
  readonly kind = 'directory' as const
  readonly files = new Map<string, Uint8Array>()
  readonly directories = new Map<string, FakeDirectory>()
  permission: PermissionState = 'granted'
  /** What `requestPermission` will answer, so a denial can be rehearsed. */
  grantOnRequest = true

  constructor(readonly name = 'tracker-data') {}

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike> {
    if (!this.files.has(name)) {
      if (!options?.create) throw notFound(name)
      this.files.set(name, new Uint8Array())
    }
    return fileHandle(this, name)
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike> {
    const existing = this.directories.get(name)
    if (existing) return existing
    if (!options?.create) throw notFound(name)
    const created = new FakeDirectory(name)
    this.directories.set(name, created)
    return created
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    if (this.files.delete(name)) return
    const directory = this.directories.get(name)
    if (!directory) throw notFound(name)
    if (!options?.recursive && (directory.files.size > 0 || directory.directories.size > 0)) {
      throw new DOMException(`${name} is not empty`, 'InvalidModificationError')
    }
    this.directories.delete(name)
  }

  async *keys(): AsyncIterableIterator<string> {
    yield* this.files.keys()
    yield* this.directories.keys()
  }

  async queryPermission(): Promise<PermissionState> {
    return this.permission
  }

  async requestPermission(): Promise<PermissionState> {
    this.permission = this.grantOnRequest ? 'granted' : 'denied'
    return this.permission
  }

  /** Reads a path like `attachments/<app>/<id>`, or null when any segment is missing. */
  read(path: string): Uint8Array | null {
    const segments = path.split('/')
    const name = segments.pop()!
    const directory = segments.reduce<FakeDirectory | null>(
      (current, segment) => current?.directories.get(segment) ?? null,
      this,
    )
    return directory?.files.get(name) ?? null
  }

  readText(path: string): string | null {
    const bytes = this.read(path)
    return bytes === null ? null : new TextDecoder().decode(bytes)
  }
}

function notFound(name: string): DOMException {
  return new DOMException(`${name} was not found`, 'NotFoundError')
}

function fileHandle(directory: FakeDirectory, name: string): FileHandleLike {
  return {
    kind: 'file',
    name,
    async getFile(): Promise<File> {
      const bytes = directory.files.get(name) ?? new Uint8Array()
      return new File([bytes as BlobPart], name)
    },
    async createWritable(): Promise<WritableStreamLike> {
      // The real API truncates on open, so a short write cannot leave a long tail behind.
      let pending: Uint8Array = new Uint8Array()
      return {
        async write(data): Promise<void> {
          pending = await toBytes(data)
        },
        async close(): Promise<void> {
          directory.files.set(name, pending)
        },
      }
    },
  }
}

async function toBytes(data: BufferSource | Blob | string): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  }
  return new Uint8Array(data)
}
