/**
 * Where the dev server serves attachment bytes. Split out from `attachments.ts` so the
 * server backend can reach it without the dispatcher importing the backend that imports
 * it back.
 */
export const ATTACHMENTS_URL = '/__attachments'

export function attachmentFileUrl(
  applicationId: string,
  attachmentId: string,
  filename?: string,
): string {
  const base = `${ATTACHMENTS_URL}/${applicationId}/${attachmentId}`
  if (!filename) return base
  return `${base}?filename=${encodeURIComponent(filename)}`
}
