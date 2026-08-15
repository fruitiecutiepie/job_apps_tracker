import { createEmptyDocument, ensureFreshIndexes, refreshTrackerDatabase } from './database'
import { createDemoDocument } from './demo'
import { serializeTrackerDocument } from './export'
import type { TrackerDatabase } from './types'
import { assertTrackerDocument, parseTrackerDocument } from './validation'

export const STORAGE_KEY = 'job-applications-tracker:v1'
export const DB_URL = '/__db'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export class MemoryTrackerStore {
  private value: string | null = null

  getItem(key: string): string | null {
    if (key !== STORAGE_KEY) return null
    return this.value
  }

  setItem(key: string, value: string): void {
    if (key !== STORAGE_KEY) return
    this.value = value
  }

  removeItem(key: string): void {
    if (key !== STORAGE_KEY) return
    this.value = null
  }

  clear(): void {
    this.value = null
  }
}

function browserStorage(): StorageLike {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('Browser storage is unavailable')
  }
  return window.localStorage
}

export function serializeTrackerDatabase(document: TrackerDatabase): string {
  return serializeTrackerDocument(document)
}

export function saveTrackerDocument(
  document: TrackerDatabase,
  storage: StorageLike = new MemoryTrackerStore(),
): TrackerDatabase {
  const refreshed = refreshTrackerDatabase(document)
  storage.setItem(STORAGE_KEY, JSON.stringify(refreshed))
  return refreshed
}

export function loadTrackerDocument(
  storage: StorageLike = new MemoryTrackerStore(),
): TrackerDatabase {
  const saved = storage.getItem(STORAGE_KEY)
  if (saved === null) {
    const empty = createEmptyDocument()
    saveTrackerDocument(empty, storage)
    return empty
  }
  try {
    const parsed = parseTrackerDocument(saved)
    const refreshed = ensureFreshIndexes(parsed)
    if (JSON.stringify(refreshed) !== saved) {
      storage.setItem(STORAGE_KEY, JSON.stringify(refreshed))
    }
    return refreshed
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Saved tracker data is invalid: ${reason}`, { cause: error })
  }
}

export function clearTrackerDocument(storage: StorageLike = new MemoryTrackerStore()): void {
  storage.removeItem(STORAGE_KEY)
}

export function resetTrackerDocument(
  storage: StorageLike = new MemoryTrackerStore(),
  reference?: Date,
): TrackerDatabase {
  const demo = createDemoDocument(reference)
  return saveTrackerDocument(demo, storage)
}

export function tryLoadLegacyLocalStorage(
  storage: StorageLike = browserStorage(),
): TrackerDatabase | null {
  const saved = storage.getItem(STORAGE_KEY)
  if (saved === null) return null
  try {
    return assertTrackerDocument(JSON.parse(saved) as unknown)
  } catch {
    return null
  }
}

export function clearLegacyLocalStorage(storage: StorageLike = browserStorage()): void {
  storage.removeItem(STORAGE_KEY)
}

export async function loadTrackerDatabase(): Promise<TrackerDatabase> {
  const response = await fetch(DB_URL)
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Failed to load tracker data (${response.status})`)
  }
  const parsed = assertTrackerDocument(await response.json())
  return ensureFreshIndexes(parsed)
}

export async function saveTrackerDatabase(document: TrackerDatabase): Promise<TrackerDatabase> {
  const refreshed = refreshTrackerDatabase(document)
  const response = await fetch(DB_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(refreshed),
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Failed to save tracker data (${response.status})`)
  }
  return assertTrackerDocument(await response.json())
}

export async function resetTrackerDatabase(): Promise<TrackerDatabase> {
  const response = await fetch(DB_URL, { method: 'DELETE' })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Failed to reset tracker data (${response.status})`)
  }
  return assertTrackerDocument(await response.json())
}
