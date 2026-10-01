import { isStateId } from './states'
import type { StateId, Status } from './types'

/**
 * The document layout this build writes.
 *
 * - **1** — every file written before this field existed, and the older
 *   `{ schema_version: 1, applications }` exports — kept how an application ended inside its
 *   state, as nineteen ids like `interview_1_rejected`.
 * - **2** split that into a stage and an outcome, with taking the job as an outcome,
 *   `accepted`, that only meant anything at an offer.
 * - **3** makes taking the job the last stage, `accepted`, so every outcome means something
 *   at every stage.
 *
 * Each step rewrites the raw document into the next layout; a file is walked forward from
 * whatever it was written in.
 */
export const DATA_VERSION = 3

/**
 * The version-1 states that were not stages, and the stage and outcome each one meant.
 * Every other version-1 state is a stage of the same name, still running.
 *
 * `offer_rejected` cannot say who turned whom down, so it stays a rejection; `no_openings`
 * was a headhunter's pitch with nothing behind it, which is the employer ending it.
 * `accepted` is a stage of its own name, so it needs no entry here.
 */
const LEGACY_STATUS: Record<string, Status> = {
  no_openings: { state: 'headhunted', outcome: 'closed' },
  auto_rejected: { state: 'applied', outcome: 'rejected' },
  recruiter_messaged_rejected: { state: 'recruiter_messaged', outcome: 'rejected' },
  online_assessment_rejected: { state: 'online_assessment', outcome: 'rejected' },
  recruiter_interview_rejected: { state: 'recruiter_interview', outcome: 'rejected' },
  take_home_assessment_rejected: { state: 'take_home_assessment', outcome: 'rejected' },
  interview_1_rejected: { state: 'interview_1', outcome: 'rejected' },
  interview_2_rejected: { state: 'interview_2', outcome: 'rejected' },
  offer_rejected: { state: 'offer', outcome: 'rejected' },
}

/** What a version-1 state means now, or null when it was never a state. */
export function legacyStatus(value: unknown): Status | null {
  if (isStateId(value)) return { state: value, outcome: 'active' }
  if (typeof value === 'string' && Object.hasOwn(LEGACY_STATUS, value)) return LEGACY_STATUS[value]!
  return null
}

/** The stage a version-1 state was filed against. Unknown values pass through to be refused. */
export function legacyState(value: unknown): unknown {
  return legacyStatus(value)?.state ?? value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function refiled(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((item) => (isRecord(item) ? { ...item, state: legacyState(item.state) } : item))
}

function earlier(left: unknown, right: unknown): unknown {
  if (typeof left !== 'string') return right
  if (typeof right !== 'string') return left
  return Date.parse(right) < Date.parse(left) ? right : left
}

function later(left: unknown, right: unknown): unknown {
  if (typeof left !== 'string') return right
  if (typeof right !== 'string') return left
  return Date.parse(right) > Date.parse(left) ? right : left
}

/**
 * Prep notes filed against a stage and against its rejection become one note, since both now
 * name the same stage. Nothing is dropped: the bodies are joined in the order they were
 * stored, and the captured lines are pooled for the validator to sort.
 */
function mergedNotes(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  const merged: unknown[] = []
  const byState = new Map<StateId, { note: Record<string, unknown>; from: Set<unknown> }>()
  for (const original of value) {
    const item = isRecord(original) ? { ...original, state: legacyState(original.state) } : original
    if (!isRecord(item) || !isRecord(original) || !isStateId(item.state)) {
      merged.push(item)
      continue
    }
    const held = byState.get(item.state)
    // Two notes that were already filed against the same state were a broken document
    // before the split, and are left for the validator to refuse rather than quietly joined.
    if (!held || held.from.has(original.state)) {
      if (!held) byState.set(item.state, { note: item, from: new Set([original.state]) })
      merged.push(item)
      continue
    }
    held.from.add(original.state)
    const existing = held.note
    const bodies = [existing.body, item.body].filter(
      (body): body is string => typeof body === 'string' && body.trim().length > 0,
    )
    existing.body = bodies.join('\n\n')
    existing.heard = [
      ...(Array.isArray(existing.heard) ? existing.heard : []),
      ...(Array.isArray(item.heard) ? item.heard : []),
    ]
    existing.created_at = earlier(existing.created_at, item.created_at)
    existing.updated_at = later(existing.updated_at, item.updated_at)
  }
  return merged
}

function migratedHistory(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry) => {
    if (!isRecord(entry)) return entry
    const status = legacyStatus(entry.state)
    return status ? { ...entry, ...status } : entry
  })
}

function migratedApplication(value: unknown): unknown {
  if (!isRecord(value)) return value
  const status = legacyStatus(value.state)
  return {
    ...value,
    ...(status ?? null),
    state_history: migratedHistory(value.state_history),
    stage_notes: mergedNotes(value.stage_notes),
    state_events: refiled(value.state_events),
    correspondence: refiled(value.correspondence),
  }
}

/** The version a raw document says it is written in; files with no field are version 1. */
export function documentVersion(value: Record<string, unknown>): unknown {
  return 'schema_version' in value ? value.schema_version : 1
}

/** Version 2's `accepted` outcome as the version-3 Accepted stage, still running. */
function acceptedAsStage(value: unknown): unknown {
  if (!isRecord(value) || value.outcome !== 'accepted') return value
  return { ...value, state: 'accepted', outcome: 'active' }
}

function version3Application(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    ...acceptedAsStage(value) as Record<string, unknown>,
    state_history: Array.isArray(value.state_history)
      ? value.state_history.map(acceptedAsStage)
      : value.state_history,
  }
}

function mapApplications(
  value: Record<string, unknown>,
  step: (application: unknown) => unknown,
): unknown {
  return Array.isArray(value.applications) ? value.applications.map(step) : value.applications
}

/**
 * Walks a document forward to the current layout, leaving validation to decide whether what
 * came out is sound. Raw in, raw out: the validator is the one place a document is
 * canonicalized, and it runs straight after this. Version 1's migration writes the current
 * stage-and-outcome layout directly — its `accepted` state was always a stage — so only a
 * version-2 file takes the second step.
 */
export function migrateDocument(value: Record<string, unknown>): Record<string, unknown> {
  const version = documentVersion(value)
  if (version === 1) {
    return { ...value, schema_version: DATA_VERSION, applications: mapApplications(value, migratedApplication) }
  }
  if (version === 2) {
    return { ...value, schema_version: DATA_VERSION, applications: mapApplications(value, version3Application) }
  }
  return value
}

/** Whether a raw document is a version this build still reads, but no longer writes. */
export function isOlderVersion(version: unknown): boolean {
  return version === 1 || version === 2
}

/** Whether a raw document predates the current layout and will be rewritten on load. */
export function needsMigration(value: unknown): boolean {
  return isRecord(value) && isOlderVersion(documentVersion(value))
}
