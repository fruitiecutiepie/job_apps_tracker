// @vitest-environment node
/*
 * Node rather than jsdom: jsdom replaces the global `File`, and Node's multipart parser —
 * the same one a Worker's `request.formData()` stands for — then refuses to build one.
 */
import { describe, expect, it } from 'vitest'

import { handleFeedbackRequest, memoryFeedbackStore } from './server'
import { MAX_SCREENSHOTS, type FeedbackRecord, type FeedbackSubmission } from './report'

const BASE = 'https://example.test/projects/job_apps_tracker/app/api/feedback'
const TOKEN = 'secret-token'

function submission(overrides: Partial<FeedbackSubmission> = {}): FeedbackSubmission {
  return {
    kind: 'bug',
    message: 'The Kanban card will not move.',
    email: 'me@example.com',
    steps: [{ at: '2026-10-09T10:00:00.000Z', text: 'Clicked button “Kanban”' }],
    context: {
      view: 'Kanban',
      build: 'hosted',
      path: '/projects/job_apps_tracker/app',
      userAgent: 'Test',
      language: 'en',
      viewport: '1280×800',
      pixelRatio: 2,
    },
    created_at: '2026-10-09T10:00:00.000Z',
    ...overrides,
  }
}

/*
 * The multipart body is built by hand rather than from a `FormData`, so what is parsed is
 * the bytes a browser actually sends rather than an object the same runtime made.
 */
function multipart(
  report: unknown,
  files: Array<{ type: string; bytes: Uint8Array }> = [],
): { body: Uint8Array<ArrayBuffer>; contentType: string } {
  const boundary = '----feedback-test-boundary'
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = [
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="report"\r\n\r\n${
        typeof report === 'string' ? report : JSON.stringify(report)
      }\r\n`,
    ),
  ]
  files.forEach((file, index) => {
    chunks.push(encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="screenshot"; filename="shot-${index}.png"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ))
    chunks.push(file.bytes)
    chunks.push(encoder.encode('\r\n'))
  })
  chunks.push(encoder.encode(`--${boundary}--\r\n`))
  const body = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.length
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

function post(report: unknown, files?: Array<{ type: string; bytes: Uint8Array }>, headers: Record<string, string> = {}) {
  const { body, contentType } = multipart(report, files)
  return new Request(BASE, { method: 'POST', body, headers: { 'Content-Type': contentType, ...headers } })
}

function admin(path = '', init: RequestInit = {}, token = TOKEN) {
  return new Request(`${BASE}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
  })
}

const PNG = { type: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) }

async function setup() {
  const store = memoryFeedbackStore()
  const options = { store, adminToken: TOKEN, now: () => new Date('2026-10-09T10:05:00.000Z') }
  const handle = async (request: Request) => (await handleFeedbackRequest(request, options))!
  return { store, handle }
}

describe('the feedback route', () => {
  it('leaves every other path to the app', async () => {
    const { handle } = await setup()
    expect(await handle(new Request('https://example.test/projects/job_apps_tracker/app/'))).toBeNull()
    expect(await handle(new Request('https://example.test/api/feedbackish'))).toBeNull()
  })

  it('stores a report with its screenshots, without anyone signing in', async () => {
    const { handle, store } = await setup()
    const response = await handle(post(submission(), [PNG]))
    expect(response.status).toBe(201)
    const { id } = (await response.json()) as { id: string }

    expect(store.keys().sort()).toEqual([`reports/${id}.json`, `screenshots/${id}/0`])
    const listed = (await (await handle(admin())).json()) as { reports: FeedbackRecord[] }
    expect(listed.reports).toHaveLength(1)
    expect(listed.reports[0]).toMatchObject({
      id,
      status: 'new',
      email: 'me@example.com',
      message: 'The Kanban card will not move.',
      received_at: '2026-10-09T10:05:00.000Z',
      screenshots: [{ index: 0, type: 'image/png', size: PNG.bytes.length }],
    })

    const shot = await handle(admin(`/${id}/screenshots/0`))
    expect(shot.headers.get('Content-Type')).toBe('image/png')
    expect(new Uint8Array(await shot.arrayBuffer())).toEqual(PNG.bytes)
  })

  it('drops fields it does not know rather than storing them', async () => {
    const { handle } = await setup()
    await handle(post({ ...submission(), tracker: { applications: ['private'] } }))
    const listed = (await (await handle(admin())).json()) as { reports: Array<Record<string, unknown>> }
    expect(listed.reports[0]).not.toHaveProperty('tracker')
  })

  it('accepts a report with no email', async () => {
    const { handle } = await setup()
    expect((await handle(post(submission({ email: null })))).status).toBe(201)
  })

  it.each([
    ['a blank message', submission({ message: '   ' }), 'Say what happened'],
    ['an unknown kind', { ...submission(), kind: 'praise' }, 'Unknown kind'],
    ['an email that is not one', submission({ email: 'nope' }), 'email address'],
  ])('refuses %s and stores nothing', async (_, report, error) => {
    const { handle, store } = await setup()
    const response = await handle(post(report))
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toContain(error)
    expect(store.keys()).toEqual([])
  })

  it('refuses a body that is not JSON', async () => {
    const { handle } = await setup()
    expect((await handle(post('{not json'))).status).toBe(400)
  })

  it('refuses a screenshot that is not an image, and too many of them', async () => {
    const { handle, store } = await setup()
    expect((await handle(post(submission(), [{ type: 'text/html', bytes: new Uint8Array([60]) }]))).status).toBe(400)
    const many = Array.from({ length: MAX_SCREENSHOTS + 1 }, () => PNG)
    expect((await handle(post(submission(), many))).status).toBe(400)
    expect(store.keys()).toEqual([])
  })

  it('refuses a report another site sends', async () => {
    const { handle } = await setup()
    expect((await handle(post(submission(), [], { 'Sec-Fetch-Site': 'cross-site' }))).status).toBe(403)
    expect((await handle(post(submission(), [], { 'Sec-Fetch-Site': 'same-origin' }))).status).toBe(201)
  })

  it('reads, triages and deletes only with the token', async () => {
    const { handle, store } = await setup()
    const { id } = (await (await handle(post(submission(), [PNG]))).json()) as { id: string }

    expect((await handle(new Request(BASE))).status).toBe(401)
    expect((await handle(admin('', {}, 'wrong'))).status).toBe(401)
    expect((await handle(admin(`/${id}/screenshots/0`, {}, 'wrong'))).status).toBe(401)
    expect((await handle(admin(`/${id}`, { method: 'DELETE' }, 'wrong'))).status).toBe(401)

    const patched = await handle(admin(`/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(((await patched.json()) as FeedbackRecord).status).toBe('done')
    expect((await handle(admin(`/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'lost' }) }))).status).toBe(400)

    expect((await handle(admin(`/${id}`, { method: 'DELETE' }))).status).toBe(204)
    expect(store.keys()).toEqual([])
  })

  it('keeps the inbox shut when no token is configured, while still taking reports', async () => {
    const store = memoryFeedbackStore()
    const handle = async (request: Request) => (await handleFeedbackRequest(request, { store, adminToken: null }))!
    expect((await handle(post(submission()))).status).toBe(201)
    expect((await handle(admin())).status).toBe(503)
  })

  it('lists newest first', async () => {
    const store = memoryFeedbackStore()
    let clock = Date.parse('2026-10-09T10:00:00.000Z')
    const handle = async (request: Request) =>
      (await handleFeedbackRequest(request, { store, adminToken: TOKEN, now: () => new Date((clock += 1000)) }))!
    await handle(post(submission({ message: 'first' })))
    await handle(post(submission({ message: 'second' })))
    const listed = (await (await handle(admin())).json()) as { reports: FeedbackRecord[] }
    expect(listed.reports.map((report) => report.message)).toEqual(['second', 'first'])
  })

  it('serves the inbox page to anyone, holding no reports in it', async () => {
    const { handle } = await setup()
    await handle(post(submission({ message: 'not in the page' })))
    const page = await handle(new Request(`${BASE}/inbox`))
    expect(page.status).toBe(200)
    expect(page.headers.get('Content-Type')).toContain('text/html')
    expect(page.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    const html = await page.text()
    expect(html).toContain('Feedback inbox')
    // Locally the token is not the hosted one, and the page says so rather than just refusing.
    expect(html).toContain('Running locally, the token is <code>local</code>')
    expect(html).not.toContain('not in the page')
    // Reports are strangers' text: the page must only ever set it as text.
    expect(html).not.toContain('innerHTML')
  })
})
