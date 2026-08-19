/*
 * The rating selects behind the editor's rating fields: how a stored judgement becomes a
 * select value, and how select values become drafts the domain can take. Three states have
 * to survive the round trip — never assessed, explicitly unknown, and judged — so the
 * mapping is spelled out rather than coerced.
 */
import { RATING_IDS } from './domain'
import type { Application, RatingDimensionId, RatingDraft } from './domain'

/** The sentinel a select uses for "asked, and genuinely cannot tell". */
export const UNKNOWN_RATING = 'unknown'

/** `''` means never assessed, `UNKNOWN_RATING` means unknown, digits mean a judgement. */
export type RatingValues = Record<RatingDimensionId, string>

export function ratingValuesFor(application: Application | null): RatingValues {
  const values = {} as RatingValues
  for (const dimension of RATING_IDS) {
    const rating = application?.ratings.find((item) => item.dimension === dimension)
    values[dimension] = rating ? (rating.score === null ? UNKNOWN_RATING : String(rating.score)) : ''
  }
  return values
}

/**
 * Drafts for the dimensions that carry a judgement. A blank stays out: an absent draft
 * leaves a dimension untouched, and clearing one back to never-assessed is `clearRating`.
 *
 * Deliberately a switch rather than `Number(value) || null`: `Number('')` is 0, which is not
 * a valid score, and `Number('unknown')` is NaN, which would slip past a typeof check.
 */
export function ratingDrafts(values: RatingValues): RatingDraft[] {
  return RATING_IDS.flatMap((dimension): RatingDraft[] => {
    const value = values[dimension]
    if (value === '') return []
    if (value === UNKNOWN_RATING) return [{ dimension, score: null }]
    return [{ dimension, score: Number(value) }]
  })
}

/** The dimensions blanked back to never-assessed, which drafts alone cannot express. */
export function clearedRatingDimensions(
  application: Application | null,
  values: RatingValues,
): RatingDimensionId[] {
  return RATING_IDS.filter(
    (dimension) =>
      values[dimension] === ''
      && (application?.ratings.some((item) => item.dimension === dimension) ?? false),
  )
}
