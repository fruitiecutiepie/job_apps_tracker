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

export function isStateId(value: unknown): value is StateId {
  return typeof value === 'string' && stateSet.has(value)
}

export function stateLabel(state: StateId): string {
  return STATE_LABELS[state]
}

export function rejectedStateFor(state: StateId): StateId | null {
  if (state === 'applied') return 'auto_rejected'
  const counterpart = `${state}_rejected`
  return isStateId(counterpart) ? counterpart : null
}
