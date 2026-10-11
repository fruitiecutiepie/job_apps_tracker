import { feedbackEndpoint } from '../siteLinks'
import type { FeedbackSubmission } from './report'

function extension(type: string): string {
  return type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png'
}

/** Posts a report and its screenshots, resolving to the inbox's id for it. */
export async function sendFeedback(
  submission: FeedbackSubmission,
  screenshots: Blob[],
): Promise<string> {
  const form = new FormData()
  form.append('report', JSON.stringify(submission))
  screenshots.forEach((blob, index) => {
    form.append('screenshot', blob, `screenshot-${index + 1}.${extension(blob.type)}`)
  })

  let response: Response
  try {
    response = await fetch(feedbackEndpoint(), { method: 'POST', body: form })
  } catch {
    throw new Error('Could not reach the feedback inbox. Check your connection and try again.')
  }
  if (!response.ok) {
    let message = `The feedback inbox answered ${response.status}.`
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === 'string') message = body.error
    } catch {
      // Not JSON; the status says enough.
    }
    throw new Error(message)
  }
  const body = (await response.json()) as { id?: unknown }
  return typeof body.id === 'string' ? body.id : ''
}
