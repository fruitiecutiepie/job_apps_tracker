import type { OutcomeId, StateId, Status } from './types'

/**
 * The stages, in the order an application usually passes through them. An application's
 * stage is how far it got; whether it is still going is its outcome, below. The last one,
 * Accepted, is where a search succeeds: reached, still active, it is the job you took.
 */
export const STATE_CONFIG = [
  { id: 'headhunted', label: 'Headhunted' },
  { id: 'applied', label: 'Applied' },
  { id: 'recruiter_messaged', label: 'Recruiter messaged' },
  { id: 'online_assessment', label: 'Online assessment' },
  { id: 'recruiter_interview', label: 'Recruiter interview' },
  { id: 'take_home_assessment', label: 'Take-home assessment' },
  { id: 'interview_1', label: 'Interview 1' },
  { id: 'interview_2', label: 'Interview 2' },
  { id: 'offer', label: 'Offer' },
  { id: 'accepted', label: 'Accepted' },
] as const satisfies readonly { id: StateId; label: string }[]

export const STATE_IDS = Object.freeze(STATE_CONFIG.map(({ id }) => id)) as readonly StateId[]

export const STATE_LABELS = Object.fromEntries(
  STATE_CONFIG.map(({ id, label }) => [id, label]),
) as Record<StateId, string>

const stateSet = new Set<string>(STATE_IDS)

const stateOrder = new Map<StateId, number>(STATE_IDS.map((id, index) => [id, index]))

export function isStateId(value: unknown): value is StateId {
  return typeof value === 'string' && stateSet.has(value)
}

/** Position of a stage in the configured order, for deterministic sorting. */
export function stateRank(state: StateId): number {
  return stateOrder.get(state) ?? STATE_IDS.length
}

export function stateLabel(state: StateId): string {
  return STATE_LABELS[state]
}

/** The stage after this one, or null at the last. A shortcut, never a restriction. */
export function nextState(state: StateId): StateId | null {
  return STATE_IDS[stateRank(state) + 1] ?? null
}

/** The stage before this one, or null at the first. */
export function previousState(state: StateId): StateId | null {
  const rank = stateRank(state)
  return rank > 0 ? STATE_IDS[rank - 1] ?? null : null
}

/**
 * How a stage is going. `active` is the one outcome that is still running; the other three
 * say who ended it, and each means something at every stage — at Accepted too, where
 * withdrawn is backing out of a job you took and closed is the offer rescinded. The order
 * is the order the filter and the editor list them in.
 */
export const OUTCOME_CONFIG = [
  { id: 'active', label: 'Active', description: 'Still running' },
  { id: 'rejected', label: 'Rejected', description: 'They turned you down' },
  { id: 'withdrawn', label: 'Withdrawn', description: 'You pulled out' },
  { id: 'closed', label: 'Closed', description: 'They stopped: role filled, pulled or frozen, or they went silent' },
] as const satisfies readonly { id: OutcomeId; label: string; description: string }[]

export const OUTCOME_IDS = Object.freeze(OUTCOME_CONFIG.map(({ id }) => id)) as readonly OutcomeId[]

const OUTCOME_LABELS = Object.fromEntries(
  OUTCOME_CONFIG.map(({ id, label }) => [id, label]),
) as Record<OutcomeId, string>

const outcomeSet = new Set<string>(OUTCOME_IDS)

export function isOutcomeId(value: unknown): value is OutcomeId {
  return typeof value === 'string' && outcomeSet.has(value)
}

export function outcomeLabel(outcome: OutcomeId): string {
  return OUTCOME_LABELS[outcome]
}

export function outcomeRank(outcome: OutcomeId): number {
  return OUTCOME_IDS.indexOf(outcome)
}

/** The ways an application ends — every outcome but `active` — which the End menu offers. */
export const ENDING_OUTCOMES = Object.freeze(
  OUTCOME_IDS.filter((outcome) => outcome !== 'active'),
) as readonly OutcomeId[]

/**
 * The words a stage and an outcome read as together. Two pairs keep the names they had as
 * states of their own, because those are the words people already use for them — nobody
 * says "Applied — Rejected" for an application that never reached a person.
 */
const STATUS_NAMES: Partial<Record<`${StateId}:${OutcomeId}`, string>> = {
  'applied:rejected': 'Auto-rejected',
  'headhunted:closed': 'No openings',
}

export function statusLabel({ state, outcome }: Status): string {
  if (outcome === 'active') return stateLabel(state)
  return STATUS_NAMES[`${state}:${outcome}`] ?? `${stateLabel(state)} — ${outcomeLabel(outcome)}`
}

export function sameStatus(left: Status, right: Status): boolean {
  return left.state === right.state && left.outcome === right.outcome
}

/** The stage a search ends in when it succeeds. */
export const FINAL_STATE: StateId = 'accepted'

/**
 * Whether an application is still running, was turned down, or is finished some other way:
 * withdrawn, closed by the employer — or accepted, the job you took, which is finished for
 * the search even while it is active as an application. That last is what keeps an accepted
 * job out of the urgency ranking and off the Idle list, and what lets Archive all ended put
 * it away with the rest when the next search starts.
 *
 * A view-only grouping: it never restricts moves, and any status can still move to any other.
 */
export type Lifecycle = 'live' | 'rejected' | 'closed'

export function classifyLifecycle({ state, outcome }: Status): Lifecycle {
  if (outcome === 'rejected') return 'rejected'
  if (outcome !== 'active' || state === FINAL_STATE) return 'closed'
  return 'live'
}

/**
 * Whether moving into this outcome abandons a task left on the application. Turned down and
 * pulled out both end the work; one on a role the employer closed may be "check back in
 * March". A task on an accepted job is live work, and reaching Accepted is a stage move,
 * which never drops a task.
 */
export function outcomeAbandonsTask(outcome: OutcomeId): boolean {
  return outcome === 'rejected' || outcome === 'withdrawn'
}

/** What the stage filter can be set to: one stage, or all of them. */
export type StateFilter = StateId | 'all'

export function stateFilterMatches(filter: StateFilter, state: StateId): boolean {
  return filter === 'all' || state === filter
}

/** The stages a filter admits, or undefined for the filter that admits every one. */
export function statesForFilter(filter: StateFilter): readonly StateId[] | undefined {
  return filter === 'all' ? undefined : [filter]
}

/**
 * What the outcome filter can be set to: one outcome, `ended` for any of the four that are not
 * `active`, or all. Orthogonal to the stage filter, so "Interview 1, rejected" is one pair of
 * choices rather than a state of its own.
 */
export type OutcomeFilter = OutcomeId | 'all' | 'ended'

export function outcomeFilterMatches(filter: OutcomeFilter, outcome: OutcomeId): boolean {
  if (filter === 'all') return true
  if (filter === 'ended') return outcome !== 'active'
  return outcome === filter
}

export function outcomesForFilter(filter: OutcomeFilter): readonly OutcomeId[] {
  return OUTCOME_IDS.filter((outcome) => outcomeFilterMatches(filter, outcome))
}

/**
 * Whether archived applications are in view. `current` is the default: the search you are
 * running now, with the last one's leftovers put away.
 */
export type ArchiveFilter = 'current' | 'archived' | 'all'

export function archiveFilterMatches(filter: ArchiveFilter, archivedAt: string | null): boolean {
  if (filter === 'all') return true
  return filter === 'archived' ? archivedAt !== null : archivedAt === null
}
