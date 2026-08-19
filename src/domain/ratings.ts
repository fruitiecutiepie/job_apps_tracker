import type { RatingDimensionId } from './types'

/**
 * The dimensions you can judge a role on. A dimension belongs here only if two reasonable
 * people could rate the same fact differently. Compensation is deliberately absent: given a
 * number everyone agrees more is better, so it is a measurement rather than a judgement.
 */
export const RATING_CONFIG = [
  { id: 'work', label: 'Work' },
  { id: 'growth', label: 'Growth' },
  { id: 'people', label: 'People' },
  // Not just "Company": the editor already has a Company field, and two controls with the
  // same accessible name in one dialog is ambiguous for anyone navigating by label.
  { id: 'company', label: 'Company & product' },
] as const satisfies readonly { id: RatingDimensionId; label: string }[]

export const RATING_IDS = Object.freeze(
  RATING_CONFIG.map(({ id }) => id),
) as readonly RatingDimensionId[]

export const RATING_LABELS = Object.fromEntries(
  RATING_CONFIG.map(({ id, label }) => [id, label]),
) as Record<RatingDimensionId, string>

/** The inclusive range a judged score must fall in. */
export const MIN_RATING_SCORE = 1
export const MAX_RATING_SCORE = 5

const dimensionSet = new Set<string>(RATING_IDS)

const dimensionOrder = new Map<RatingDimensionId, number>(
  RATING_IDS.map((id, index) => [id, index]),
)

export function isRatingDimension(value: unknown): value is RatingDimensionId {
  return typeof value === 'string' && dimensionSet.has(value)
}

/** Position of a dimension in the configured order, for deterministic sorting. */
export function ratingRank(dimension: RatingDimensionId): number {
  return dimensionOrder.get(dimension) ?? RATING_IDS.length
}

export function ratingLabel(dimension: RatingDimensionId): string {
  return RATING_LABELS[dimension]
}

/** A judged score: an integer inside the configured range. `null` means explicitly unknown. */
export function isRatingScore(value: unknown): value is number {
  return (
    typeof value === 'number'
    && Number.isInteger(value)
    && value >= MIN_RATING_SCORE
    && value <= MAX_RATING_SCORE
  )
}
