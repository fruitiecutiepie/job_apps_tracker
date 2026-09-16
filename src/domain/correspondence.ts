import type { CorrespondenceDirection } from './types'

/**
 * Which way a message went. There are two values and there is deliberately no third: half of
 * hiring correspondence is what you sent, and a log holding one side reads as a mystery,
 * while anything that is neither — a thought about the process, a reminder — is `notes` or a
 * prep note. A third direction would reopen the misuse this record was added to end.
 *
 * This is the only source of the ids, their labels and their order, the way `RATING_CONFIG`
 * is for dimensions and `STATE_CONFIG` is for states.
 */
export const CORRESPONDENCE_CONFIG = [
  { id: 'received', label: 'Received' },
  { id: 'sent', label: 'Sent' },
] as const satisfies readonly { id: CorrespondenceDirection; label: string }[]

export const CORRESPONDENCE_DIRECTION_IDS = Object.freeze(
  CORRESPONDENCE_CONFIG.map(({ id }) => id),
) as readonly CorrespondenceDirection[]

export const CORRESPONDENCE_DIRECTION_LABELS = Object.fromEntries(
  CORRESPONDENCE_CONFIG.map(({ id, label }) => [id, label]),
) as Record<CorrespondenceDirection, string>

/**
 * What the editor offers behind the channel box, which is free text rather than a closed set.
 * The picker curates the vocabulary and widening it must never narrow what import accepts —
 * the arrangement `source` already keeps. A union would be wrong the first time a message
 * arrives by SMS, and there are no migrations here that could widen one later.
 */
export const CHANNEL_SUGGESTIONS = ['Email', 'LinkedIn', 'Phone', 'SMS', 'In person'] as const

const directionSet = new Set<string>(CORRESPONDENCE_DIRECTION_IDS)

const directionOrder = new Map<CorrespondenceDirection, number>(
  CORRESPONDENCE_DIRECTION_IDS.map((id, index) => [id, index]),
)

export function isCorrespondenceDirection(value: unknown): value is CorrespondenceDirection {
  return typeof value === 'string' && directionSet.has(value)
}

/** Position of a direction in the configured order, for deterministic sorting. */
export function directionRank(direction: CorrespondenceDirection): number {
  return directionOrder.get(direction) ?? CORRESPONDENCE_DIRECTION_IDS.length
}

export function correspondenceDirectionLabel(direction: CorrespondenceDirection): string {
  return CORRESPONDENCE_DIRECTION_LABELS[direction]
}
