import { isStageIdShape } from './states'
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
 * - **4** gives three stages ids that say what they are rather than what they were called —
 *   `recruiter_interview` is `screening`, `interview_1` and `interview_2` are `round_1` and
 *   `round_2` — because a tracker can now rename any stage and add rounds, and an id that was
 *   a label would read wrong the moment its label changed.
 *
 * Each step rewrites the raw document into the next layout; a file is walked forward from
 * whatever it was written in.
 */
export const DATA_VERSION = 4

/** The version-3 stage ids that version 4 renamed, and what they are now. */
const RENAMED_STAGES: Record<string, StateId> = {
  recruiter_interview: 'screening',
  interview_1: 'round_1',
  interview_2: 'round_2',
}

/** A version-3 stage id as it is now. Anything else passes through unchanged. */
function renamedStage(value: unknown): unknown {
  return typeof value === 'string' && Object.hasOwn(RENAMED_STAGES, value) ? RENAMED_STAGES[value] : value
}

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
  recruiter_interview_rejected: { state: 'screening', outcome: 'rejected' },
  take_home_assessment_rejected: { state: 'take_home_assessment', outcome: 'rejected' },
  interview_1_rejected: { state: 'round_1', outcome: 'rejected' },
  interview_2_rejected: { state: 'round_2', outcome: 'rejected' },
  offer_rejected: { state: 'offer', outcome: 'rejected' },
}

/**
 * What a state from any earlier layout means now, or null when it was never a state: a
 * version-1 state that was not a stage, a stage version 4 renamed, or a stage as it is.
 */
export function legacyStatus(value: unknown): Status | null {
  const renamed = renamedStage(value)
  if (isStageIdShape(renamed)) return { state: renamed, outcome: 'active' }
  if (typeof value === 'string' && Object.hasOwn(LEGACY_STATUS, value)) return LEGACY_STATUS[value]!
  return null
}

/**
 * The stage a state from any earlier layout was filed against. Unknown values pass through to
 * be refused.
 */
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
    if (!isRecord(item) || !isRecord(original) || !isStageIdShape(item.state)) {
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

function renamedFiling(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((item) => (isRecord(item) ? { ...item, state: renamedStage(item.state) } : item))
}

/**
 * Version 3's stage ids as version 4's, everywhere an application files something by stage.
 * A history entry carries its stage under the same key, so it is refiled the same way.
 */
function version4Application(value: unknown): unknown {
  if (!isRecord(value)) return value
  return {
    ...value,
    state: renamedStage(value.state),
    state_history: renamedFiling(value.state_history),
    stage_notes: renamedFiling(value.stage_notes),
    state_events: renamedFiling(value.state_events),
    correspondence: renamedFiling(value.correspondence),
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
 * layout directly — its `accepted` state was always a stage, and `legacyStatus` already
 * answers in version-4 ids — while a version-2 file takes the Accepted step and then the
 * renaming one, and a version-3 file the renaming one alone.
 */
export function migrateDocument(value: Record<string, unknown>): Record<string, unknown> {
  const version = documentVersion(value)
  if (version === 1) {
    return { ...value, schema_version: DATA_VERSION, applications: mapApplications(value, migratedApplication) }
  }
  if (version === 2) {
    return {
      ...value,
      schema_version: DATA_VERSION,
      applications: mapApplications(value, (application) => version4Application(version3Application(application))),
    }
  }
  if (version === 3) {
    return { ...value, schema_version: DATA_VERSION, applications: mapApplications(value, version4Application) }
  }
  return value
}

/** Whether a raw document is a version this build still reads, but no longer writes. */
export function isOlderVersion(version: unknown): boolean {
  return version === 1 || version === 2 || version === 3
}

/** Whether a raw document predates the current layout and will be rewritten on load. */
export function needsMigration(value: unknown): boolean {
  return isRecord(value) && isOlderVersion(documentVersion(value))
}
