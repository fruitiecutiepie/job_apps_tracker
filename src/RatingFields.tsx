import { MAX_RATING_SCORE, MIN_RATING_SCORE, RATING_CONFIG } from './domain'
import type { RatingDimensionId } from './domain'
import { UNKNOWN_RATING, type RatingValues } from './ratings'

/**
 * Word anchors matter: bare digits give no cue about which end is good, and these are
 * subjective judgements where the reader has to know.
 */
const SCORE_LABELS: readonly string[] = ['Poor', 'Weak', 'Mixed', 'Good', 'Great']

const SCORES = Array.from(
  { length: MAX_RATING_SCORE - MIN_RATING_SCORE + 1 },
  (_, index) => MIN_RATING_SCORE + index,
)

interface RatingFieldsProps {
  values: RatingValues
  onChange: (dimension: RatingDimensionId, value: string) => void
}

/**
 * One select per dimension. Each carries its own visible label, because a `label` associates
 * with only its first labelable descendant — grouping four selects under one label would
 * leave three of them nameless.
 */
export function RatingFields({ values, onChange }: RatingFieldsProps) {
  return (
    <div className="field field--wide rating-field">
      <span>Ratings</span>

      <div className="rating-grid">
        {RATING_CONFIG.map(({ id, label }) => (
          <label className="field" key={id}>
            <span>{label}</span>
            <select onChange={(event) => onChange(id, event.target.value)} value={values[id]}>
              <option value="">Not rated</option>
              {SCORES.map((score) => (
                <option key={score} value={String(score)}>
                  {score} — {SCORE_LABELS[score - MIN_RATING_SCORE]}
                </option>
              ))}
              {/* Last, so typing a digit still jumps straight to a score. */}
              <option value={UNKNOWN_RATING}>Don&rsquo;t know</option>
            </select>
          </label>
        ))}
      </div>
    </div>
  )
}
