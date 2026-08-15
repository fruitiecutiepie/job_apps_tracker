import { safeAttachmentFilename } from './attachmentPaths'
import { isStateId } from './states'
import type { Application, Attachment, StateHistoryEntry, TrackerDatabase } from './types'
import { prepareTrackerDatabase } from './database'

export interface ValidationSuccess {
  ok: true
  value: TrackerDatabase
  errors: []
}

export interface ValidationError {
  path: string
  message: string
}

export interface ValidationFailure {
  ok: false
  errors: ValidationError[]
}

export type ValidationResult = ValidationSuccess | ValidationFailure

const QUALIFIED_ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = QUALIFIED_ISO.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false

  const endOfMonth = new Date(0)
  endOfMonth.setUTCFullYear(year, month, 0)
  if (day < 1 || day > endOfMonth.getUTCDate()) return false

  if (match[8] !== 'Z') {
    const offsetHour = Number(match[10])
    const offsetMinute = Number(match[11])
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false
  }

  return !Number.isNaN(Date.parse(value))
}

function addError(errors: ValidationError[], path: string, message: string): void {
  errors.push({ path, message })
}

function nullableText(value: unknown, path: string, errors: ValidationError[]): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    addError(errors, path, 'must be a string or null')
    return null
  }
  return value.trim() || null
}

function urlValue(value: unknown, path: string, errors: ValidationError[]): string | null {
  const url = nullableText(value, path, errors)
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
  } catch {
    addError(errors, path, 'must be a valid http or https URL')
    return null
  }
  return url
}

function historyValue(
  value: unknown,
  path: string,
  state: Application['state'],
  createdAt: string,
  errors: ValidationError[],
): StateHistoryEntry[] {
  if (value === undefined) return [{ state, at: createdAt }]
  if (!Array.isArray(value) || value.length === 0) {
    addError(errors, path, 'must be a non-empty array')
    return []
  }
  const history: StateHistoryEntry[] = []
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      addError(errors, `${path}[${index}]`, 'must be an object')
      return
    }
    if (!isStateId(entry.state)) addError(errors, `${path}[${index}].state`, 'is invalid')
    if (!validTimestamp(entry.at)) {
      addError(errors, `${path}[${index}].at`, 'must be a timezone-qualified ISO-8601 timestamp')
    }
    if (isStateId(entry.state) && validTimestamp(entry.at)) history.push({ state: entry.state, at: entry.at })
  })
  if (history.length > 0 && history[history.length - 1].state !== state) {
    addError(errors, path, "must end in the application's current state")
  }
  return history
}

function attachmentValue(value: unknown, path: string, errors: ValidationError[]): Attachment | null {
  if (!isRecord(value)) {
    addError(errors, path, 'must be an object')
    return null
  }
  if (!nonBlank(value.id)) addError(errors, `${path}.id`, 'is required')
  if (!nonBlank(value.filename)) addError(errors, `${path}.filename`, 'is required')
  if (!validTimestamp(value.created_at)) {
    addError(errors, `${path}.created_at`, 'must be a timezone-qualified ISO-8601 timestamp')
  }
  if (typeof value.size !== 'number' || !Number.isInteger(value.size) || value.size < 1) {
    addError(errors, `${path}.size`, 'must be a positive integer')
  }
  if (
    !nonBlank(value.id)
    || !nonBlank(value.filename)
    || !validTimestamp(value.created_at)
    || typeof value.size !== 'number'
    || !Number.isInteger(value.size)
    || value.size < 1
  ) {
    return null
  }

  let filename: string
  try {
    filename = safeAttachmentFilename(value.filename)
  } catch {
    addError(errors, `${path}.filename`, 'is invalid')
    return null
  }

  let mime: string | null = null
  if (value.mime !== undefined && value.mime !== null) {
    if (typeof value.mime !== 'string') {
      addError(errors, `${path}.mime`, 'must be a string or null')
    } else {
      mime = value.mime.trim() || null
    }
  }

  return {
    id: value.id.trim(),
    filename,
    mime,
    size: value.size as number,
    created_at: value.created_at,
  }
}

function attachmentsValue(value: unknown, path: string, errors: ValidationError[]): Attachment[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    addError(errors, path, 'must be an array')
    return []
  }

  const attachments = value
    .map((attachment, index) => attachmentValue(attachment, `${path}[${index}]`, errors))
    .filter((attachment): attachment is Attachment => attachment !== null)

  const seen = new Set<string>()
  attachments.forEach((attachment, index) => {
    if (seen.has(attachment.id)) addError(errors, `${path}[${index}].id`, 'duplicates another attachment')
    seen.add(attachment.id)
  })

  return attachments
}

function applicationValue(value: unknown, index: number, errors: ValidationError[]): Application | null {
  const path = `applications[${index}]`
  if (!isRecord(value)) {
    addError(errors, path, 'must be an object')
    return null
  }
  if (!nonBlank(value.id)) addError(errors, `${path}.id`, 'is required')
  if (!nonBlank(value.company)) addError(errors, `${path}.company`, 'is required')
  if (!isStateId(value.state)) addError(errors, `${path}.state`, 'is invalid')
  if (!validTimestamp(value.created_at)) {
    addError(errors, `${path}.created_at`, 'must be a timezone-qualified ISO-8601 timestamp')
  }
  if (!validTimestamp(value.updated_at)) {
    addError(errors, `${path}.updated_at`, 'must be a timezone-qualified ISO-8601 timestamp')
  }
  if (!nonBlank(value.id) || !nonBlank(value.company) || !isStateId(value.state) || !validTimestamp(value.created_at) || !validTimestamp(value.updated_at)) return null

  const nextAction = nullableText(value.next_action, `${path}.next_action`, errors)
  let nextActionAt: string | null = null
  if (value.next_action_at !== undefined && value.next_action_at !== null && value.next_action_at !== '') {
    if (validTimestamp(value.next_action_at)) {
      nextActionAt = value.next_action_at
    } else {
      addError(errors, `${path}.next_action_at`, 'must be a timezone-qualified ISO-8601 timestamp or null')
    }
  }

  return {
    id: value.id.trim(),
    company: value.company.trim(),
    role: nullableText(value.role, `${path}.role`, errors),
    url: urlValue(value.url, `${path}.url`, errors),
    source: nullableText(value.source, `${path}.source`, errors),
    state: value.state,
    state_history: historyValue(value.state_history, `${path}.state_history`, value.state, value.created_at, errors),
    next_action: nextAction,
    next_action_at: nextAction ? nextActionAt : null,
    notes: nullableText(value.notes, `${path}.notes`, errors),
    attachments: attachmentsValue(value.attachments, `${path}.attachments`, errors),
    created_at: value.created_at,
    updated_at: value.updated_at,
  }
}

function validateApplications(value: unknown, errors: ValidationError[]): Application[] | null {
  if (!Array.isArray(value)) {
    addError(errors, 'applications', 'must be an array')
    return null
  }

  const applications = value
    .map((application, index) => applicationValue(application, index, errors))
    .filter((application): application is Application => application !== null)
  const seen = new Set<string>()
  applications.forEach((application, index) => {
    if (seen.has(application.id)) addError(errors, `applications[${index}].id`, 'duplicates another application')
    seen.add(application.id)
  })

  return applications
}

export function validateTrackerDocument(value: unknown): ValidationResult {
  const errors: ValidationError[] = []
  if (!isRecord(value)) return { ok: false, errors: [{ path: '$', message: 'must be a JSON object' }] }

  if ('schema_version' in value && value.schema_version !== 1) {
    addError(errors, 'schema_version', 'must be 1')
  }

  const applications = validateApplications(value.applications, errors)
  if (!applications) return { ok: false, errors }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: prepareTrackerDatabase(applications), errors: [] }
}

export function parseTrackerDocument(text: string): TrackerDatabase {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw new TypeError('The selected file is not valid JSON')
  }
  return assertTrackerDocument(value)
}

export function assertTrackerDocument(value: unknown): TrackerDatabase {
  const result = validateTrackerDocument(value)
  if (!result.ok) {
    throw new TypeError(result.errors.map(({ path, message }) => `${path}: ${message}`).join('\n'))
  }
  return result.value
}
