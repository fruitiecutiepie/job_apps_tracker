/**
 * In-memory stand-in for the dev server's `/__note-edit` route. It stores what the app
 * wrote and lets a test act as the external editor by replacing that content.
 */
const scratchFiles = new Map<string, { body: string; modified_at: number }>()
let clock = 0
let launchResponse: Record<string, unknown> | null = null

/** Overrides what the stubbed POST reports, standing in for a differently configured server. */
export function setTestEditorLaunchResponse(response: Record<string, unknown> | null): void {
  launchResponse = response
}

function key(applicationId: string, state: string): string {
  return `${applicationId}/${state}`
}

export function wipeTestEditorSessions(): void {
  scratchFiles.clear()
  clock = 0
  launchResponse = null
}

export function testEditorSessionCount(): number {
  return scratchFiles.size
}

export function readTestEditorNote(applicationId: string, state: string): string | undefined {
  return scratchFiles.get(key(applicationId, state))?.body
}

/** Stands in for the user saving the file in their editor. */
export function writeTestEditorNote(applicationId: string, state: string, body: string): void {
  clock += 1
  scratchFiles.set(key(applicationId, state), { body, modified_at: clock })
}

export async function handleTestNoteEditFetch(url: string, init?: RequestInit): Promise<Response> {
  const segments = new URL(url, 'http://localhost').pathname.split('/').filter(Boolean)
  if (segments[0] !== '__note-edit') throw new Error(`Unhandled note edit fetch: ${url}`)

  const applicationId = segments[1]
  const state = segments[2]
  const method = init?.method ?? 'GET'

  if (method === 'DELETE' && !applicationId) {
    wipeTestEditorSessions()
    return new Response('OK', { status: 200 })
  }

  if (!applicationId || !state) {
    return new Response('An application id and stage are required', { status: 400 })
  }

  if (method === 'POST') {
    writeTestEditorNote(applicationId, state, String(init?.body ?? ''))
    return new Response(
      JSON.stringify(
        launchResponse ?? {
          path: `data/editing/${applicationId}/${state}.md`,
          absolute_path: `/repo/data/editing/${applicationId}/${state}.md`,
          editor: 'test-editor',
          source: 'env',
        },
      ),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (method === 'DELETE') {
    scratchFiles.delete(key(applicationId, state))
    return new Response('OK', { status: 200 })
  }

  const stored = scratchFiles.get(key(applicationId, state))
  if (!stored) return new Response('No editing session for this stage', { status: 404 })
  return new Response(JSON.stringify(stored), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
