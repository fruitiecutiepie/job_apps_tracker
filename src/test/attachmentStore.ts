const attachmentFiles = new Map<string, { data: Uint8Array; mime: string | null }>()

export function clearTestAttachmentStore(): void {
  attachmentFiles.clear()
}

export function testAttachmentKey(applicationId: string, attachmentId: string): string {
  return `${applicationId}/${attachmentId}`
}

export function getTestAttachment(key: string): { data: Uint8Array; mime: string | null } | undefined {
  return attachmentFiles.get(key)
}

export function setTestAttachment(
  applicationId: string,
  attachmentId: string,
  data: Uint8Array,
  mime: string | null = null,
): void {
  attachmentFiles.set(testAttachmentKey(applicationId, attachmentId), { data, mime })
}

export function deleteTestAttachment(applicationId: string, attachmentId?: string): void {
  if (!attachmentId) {
    for (const key of attachmentFiles.keys()) {
      if (key.startsWith(`${applicationId}/`)) attachmentFiles.delete(key)
    }
    return
  }
  attachmentFiles.delete(testAttachmentKey(applicationId, attachmentId))
}

export function wipeTestAttachments(): void {
  attachmentFiles.clear()
}

export async function handleTestAttachmentFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const parsed = new URL(url, 'http://localhost')
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments[0] !== '__attachments') {
    throw new Error(`Unhandled attachment fetch: ${url}`)
  }

  const applicationId = segments[1]
  const attachmentId = segments[2]

  if (init?.method === 'PUT' && applicationId && attachmentId) {
    const body = init.body
    if (!body || typeof body === 'string') {
      return new Response('Attachment file must not be empty', { status: 400 })
    }
    const buffer = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new Uint8Array()
    if (buffer.length === 0) return new Response('Attachment file must not be empty', { status: 400 })
    const mime = init.headers instanceof Headers
      ? init.headers.get('Content-Type')
      : (init.headers as Record<string, string> | undefined)?.['Content-Type']
    setTestAttachment(applicationId, attachmentId, buffer, mime)
    return new Response('OK', { status: 200 })
  }

  if (init?.method === 'DELETE') {
    if (!applicationId) {
      wipeTestAttachments()
      return new Response('OK', { status: 200 })
    }
    deleteTestAttachment(applicationId, attachmentId)
    return new Response('OK', { status: 200 })
  }

  if (applicationId && attachmentId) {
    const stored = getTestAttachment(testAttachmentKey(applicationId, attachmentId))
    if (!stored) return new Response('Attachment not found', { status: 404 })
    return new Response(stored.data.slice(), {
      status: 200,
      headers: stored.mime ? { 'Content-Type': stored.mime } : undefined,
    })
  }

  return new Response('Method not allowed', { status: 405 })
}
