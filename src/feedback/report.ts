/**
 * A feedback report as it travels from the app to whoever reads it. Shared by the panel
 * that writes one, the Worker that stores it, and the dev server that stands in for the
 * Worker locally, so the three cannot disagree about what a report is.
 *
 * Nothing in here is the reader's job-search data. The context is about the page — which
 * view, which browser, how big a window — and the steps are the names of the controls
 * pressed, never what was typed into them.
 */

export const FEEDBACK_KINDS = [
  {
    id: 'bug',
    label: 'Bug',
    prompt: 'What went wrong?',
    placeholder: 'What you did, what you expected, and what happened instead',
  },
  {
    id: 'idea',
    label: 'Idea',
    prompt: 'What would make this better?',
    placeholder: 'Something you wish it did, or did differently',
  },
  {
    id: 'other',
    label: 'Other',
    prompt: 'What is on your mind?',
    placeholder: 'A question, a thought, anything',
  },
] as const

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]['id']

export const FEEDBACK_STATUSES = ['new', 'in-progress', 'done', 'wont-do'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export interface FeedbackStep {
  at: string
  text: string
}

export interface FeedbackContext {
  /** The view or dialog the report was started from. */
  view: string
  /** `hosted`, `hosted demo`, `local` or `local demo`. */
  build: string
  path: string
  userAgent: string
  language: string
  viewport: string
  pixelRatio: number
}

/** What the panel sends. The screenshots travel beside it as files of their own. */
export interface FeedbackSubmission {
  kind: FeedbackKind
  message: string
  /** Where to say it was fixed, when the sender wants to hear. */
  email: string | null
  steps: FeedbackStep[]
  context: FeedbackContext
  created_at: string
}

export interface FeedbackScreenshotMeta {
  index: number
  type: string
  size: number
}

/** What is stored: the submission, plus what only the receiving side can know. */
export interface FeedbackRecord extends FeedbackSubmission {
  id: string
  received_at: string
  status: FeedbackStatus
  screenshots: FeedbackScreenshotMeta[]
}

export const MAX_MESSAGE_CHARS = 10_000
export const MAX_STEPS = 200
export const MAX_STEP_CHARS = 300
export const MAX_SCREENSHOTS = 4
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024
/** The whole request: the screenshots at their cap and room for the text beside them. */
export const MAX_REQUEST_BYTES = MAX_SCREENSHOTS * MAX_SCREENSHOT_BYTES + 512 * 1024
export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

const MAX_CONTEXT_CHARS = 500
const MAX_EMAIL_CHARS = 254
/*
 * Deliberately loose: one `@`, something either side, a dot in the domain. The address is
 * optional and only ever read by a person deciding whether to write back, so a stricter
 * rule would refuse real addresses to catch typos nobody is harmed by.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isFeedbackKind(value: unknown): value is FeedbackKind {
  return FEEDBACK_KINDS.some((kind) => kind.id === value)
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return FEEDBACK_STATUSES.includes(value as FeedbackStatus)
}

/** Blank is no address; anything else must look like one. */
export function normaliseEmail(value: string): string | null | 'invalid' {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_EMAIL_CHARS || !EMAIL.test(trimmed)) return 'invalid'
  return trimmed
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value))
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null
}

/**
 * Rebuilds a submission from untrusted JSON, or says what is wrong with it. Unknown
 * fields are dropped by construction, the way the tracker's own import drops them.
 */
export function parseFeedbackSubmission(
  raw: unknown,
): { ok: true; submission: FeedbackSubmission } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'The report is not an object.' }
  const value = raw as Record<string, unknown>

  if (!isFeedbackKind(value.kind)) return { ok: false, error: 'Unknown kind of report.' }

  if (typeof value.message !== 'string' || !value.message.trim()) {
    return { ok: false, error: 'Say what happened or what you would like.' }
  }
  if (value.message.length > MAX_MESSAGE_CHARS) {
    return { ok: false, error: `Keep the message under ${MAX_MESSAGE_CHARS.toLocaleString()} characters.` }
  }

  let email: string | null = null
  if (value.email !== null && value.email !== undefined) {
    if (typeof value.email !== 'string') return { ok: false, error: 'The email is not text.' }
    const parsed = normaliseEmail(value.email)
    if (parsed === 'invalid') return { ok: false, error: 'That email address does not look right.' }
    email = parsed
  }

  const rawSteps = Array.isArray(value.steps) ? value.steps : []
  if (rawSteps.length > MAX_STEPS) return { ok: false, error: 'Too many recorded steps.' }
  const steps: FeedbackStep[] = []
  for (const step of rawSteps) {
    const record = step as Record<string, unknown> | null
    const stepText = text(record?.text, MAX_STEP_CHARS)
    if (!record || !isTimestamp(record.at) || !stepText?.trim()) {
      return { ok: false, error: 'A recorded step is malformed.' }
    }
    steps.push({ at: record.at, text: stepText })
  }

  const context = (value.context ?? {}) as Record<string, unknown>
  const pixelRatio = typeof context.pixelRatio === 'number' && Number.isFinite(context.pixelRatio)
    ? context.pixelRatio
    : 1

  if (!isTimestamp(value.created_at)) return { ok: false, error: 'The report has no valid date.' }

  return {
    ok: true,
    submission: {
      kind: value.kind,
      message: value.message,
      email,
      steps,
      context: {
        view: text(context.view, MAX_CONTEXT_CHARS) ?? '',
        build: text(context.build, MAX_CONTEXT_CHARS) ?? '',
        path: text(context.path, MAX_CONTEXT_CHARS) ?? '',
        userAgent: text(context.userAgent, MAX_CONTEXT_CHARS) ?? '',
        language: text(context.language, MAX_CONTEXT_CHARS) ?? '',
        viewport: text(context.viewport, MAX_CONTEXT_CHARS) ?? '',
        pixelRatio,
      },
      created_at: value.created_at,
    },
  }
}

/** Why a file cannot go along as a screenshot, or null when it can. */
export function screenshotProblem(file: { type: string; size: number }): string | null {
  if (!SCREENSHOT_TYPES.includes(file.type as (typeof SCREENSHOT_TYPES)[number])) {
    return 'Screenshots must be PNG, JPEG or WebP images.'
  }
  if (file.size > MAX_SCREENSHOT_BYTES) return 'Each screenshot must be under 4 MB.'
  if (file.size === 0) return 'That image is empty.'
  return null
}

export function kindConfig(kind: FeedbackKind): (typeof FEEDBACK_KINDS)[number] {
  return FEEDBACK_KINDS.find((entry) => entry.id === kind) ?? FEEDBACK_KINDS[0]
}
