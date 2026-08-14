import { createDemoDocument } from './demo'
import type { TrackerDocument } from './types'
import { parseTrackerDocument } from './validation'

export const STORAGE_KEY = 'job-applications-tracker:v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(): StorageLike {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('Browser storage is unavailable')
  }
  return window.localStorage
}

export function saveTrackerDocument(document: TrackerDocument, storage: StorageLike = browserStorage()): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(document))
}

export function loadTrackerDocument(
  storage: StorageLike = browserStorage(),
  reference?: Date,
): TrackerDocument {
  const saved = storage.getItem(STORAGE_KEY)
  if (saved === null) {
    const demo = createDemoDocument(reference)
    saveTrackerDocument(demo, storage)
    return demo
  }
  try {
    return parseTrackerDocument(saved)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Saved tracker data is invalid: ${reason}`, { cause: error })
  }
}

export function clearTrackerDocument(storage: StorageLike = browserStorage()): void {
  storage.removeItem(STORAGE_KEY)
}

export function resetTrackerDocument(
  storage: StorageLike = browserStorage(),
  reference?: Date,
): TrackerDocument {
  const demo = createDemoDocument(reference)
  saveTrackerDocument(demo, storage)
  return demo
}
