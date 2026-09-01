import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { loadTrackerDocument, resetTrackerDocument, saveTrackerDocument } from '../domain/storage'
import { seedNamedCompanies } from './fixture'
import { handleTestAttachmentFetch, wipeTestAttachments } from './attachmentStore'
import { handleTestNoteEditFetch, wipeTestEditorSessions } from './noteEditStore'
import { testTrackerStore } from './trackerStore'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  window.localStorage.clear()
  testTrackerStore.clear()
  wipeTestAttachments()
  wipeTestEditorSessions()
  seedNamedCompanies()

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url.startsWith('/__attachments')) {
      return handleTestAttachmentFetch(url, init)
    }

    if (url.startsWith('/__note-edit')) {
      return handleTestNoteEditFetch(url, init)
    }

    if (url !== '/__db') {
      throw new Error(`Unhandled fetch in tests: ${url}`)
    }

    if (init?.method === 'PUT') {
      const body = JSON.parse(init.body as string) as unknown
      saveTrackerDocument(body as Parameters<typeof saveTrackerDocument>[0], testTrackerStore)
      const saved = loadTrackerDocument(testTrackerStore)
      return new Response(JSON.stringify(saved), { status: 200 })
    }

    if (init?.method === 'DELETE') {
      wipeTestAttachments()
      const demo = resetTrackerDocument(testTrackerStore)
      return new Response(JSON.stringify(demo), { status: 200 })
    }

    try {
      const loaded = loadTrackerDocument(testTrackerStore)
      return new Response(JSON.stringify(loaded), { status: 200 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new Response(message, { status: 500 })
    }
  }))
})

class ResizeObserverMock implements ResizeObserver {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock)

// jsdom has no matchMedia, and the theme hook reads it on first render. Report light so
// tests start from a known theme; a test that wants dark can stub this itself.
function matchMediaMock(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }
}

vi.stubGlobal('matchMedia', matchMediaMock)
