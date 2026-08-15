import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { loadTrackerDocument, saveTrackerDocument } from '../domain/storage'
import { handleTestAttachmentFetch, wipeTestAttachments } from './attachmentStore'
import { testTrackerStore } from './trackerStore'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  window.localStorage.clear()
  testTrackerStore.clear()
  wipeTestAttachments()

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url.startsWith('/__attachments')) {
      return handleTestAttachmentFetch(url, init)
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
      testTrackerStore.clear()
      wipeTestAttachments()
      const demo = loadTrackerDocument(testTrackerStore)
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
