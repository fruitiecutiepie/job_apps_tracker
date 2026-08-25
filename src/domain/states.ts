import type { StateId } from './types'

export const STATE_CONFIG = [
  { id: 'headhunted', label: 'Headhunted' },
  { id: 'no_openings', label: 'No openings' },
  { id: 'applied', label: 'Applied' },
  { id: 'auto_rejected', label: 'Auto-rejected' },
  { id: 'recruiter_messaged', label: 'Recruiter messaged' },
  { id: 'recruiter_messaged_rejected', label: 'Recruiter messaged — Rejected' },
  { id: 'online_assessment', label: 'Online assessment' },
  { id: 'online_assessment_rejected', label: 'Online assessment — Rejected' },
  { id: 'recruiter_interview', label: 'Recruiter interview' },
  { id: 'recruiter_interview_rejected', label: 'Recruiter interview — Rejected' },
  { id: 'take_home_assessment', label: 'Take-home assessment' },
  { id: 'take_home_assessment_rejected', label: 'Take-home assessment — Rejected' },
  { id: 'interview_1', label: 'Interview 1' },
  { id: 'interview_1_rejected', label: 'Interview 1 — Rejected' },
  { id: 'interview_2', label: 'Interview 2' },
  { id: 'interview_2_rejected', label: 'Interview 2 — Rejected' },
  { id: 'offer', label: 'Offer' },
  { id: 'offer_rejected', label: 'Offer — Rejected' },
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

/** Position of a state in the configured order, for deterministic sorting. */
export function stateRank(state: StateId): number {
  return stateOrder.get(state) ?? STATE_IDS.length
}

export function stateLabel(state: StateId): string {
  return STATE_LABELS[state]
}

export function rejectedStateFor(state: StateId): StateId | null {
  if (state === 'applied') return 'auto_rejected'
  const counterpart = `${state}_rejected`
  return isStateId(counterpart) ? counterpart : null
}

/**
 * The rejected states are exactly the counterparts of the states that have one, which is
 * what keeps this in step with STATE_CONFIG rather than restating it as a second list.
 * Note what is not here: `no_openings` and `accepted` are outcomes of their own, not
 * somebody turning the application down.
 */
const REJECTED_STATES = new Set<StateId>(
  STATE_CONFIG.map(({ id }) => rejectedStateFor(id)).filter((id): id is StateId => id !== null),
)

export function isRejectedState(state: StateId): boolean {
  return REJECTED_STATES.has(state)
}

export const REJECTED_STATE_IDS = Object.freeze(
  STATE_IDS.filter(isRejectedState),
) as readonly StateId[]

export const NOT_REJECTED_STATE_IDS = Object.freeze(
  STATE_IDS.filter((id) => !isRejectedState(id)),
) as readonly StateId[]

/**
 * What the state filter can be set to: one state, one of the two outcome groups, or all.
 * The groups share the control rather than adding one of their own — they answer the same
 * question a single state does, so picking both at once was never meaningful.
 */
export type StateFilter = StateId | 'all' | 'rejected' | 'not_rejected'

export function stateFilterMatches(filter: StateFilter, state: StateId): boolean {
  if (filter === 'all') return true
  if (filter === 'rejected') return isRejectedState(state)
  if (filter === 'not_rejected') return !isRejectedState(state)
  return state === filter
}

/** The states a filter admits, or undefined for the filter that admits every one. */
export function statesForFilter(filter: StateFilter): readonly StateId[] | undefined {
  if (filter === 'all') return undefined
  if (filter === 'rejected') return REJECTED_STATE_IDS
  if (filter === 'not_rejected') return NOT_REJECTED_STATE_IDS
  return [filter]
}
