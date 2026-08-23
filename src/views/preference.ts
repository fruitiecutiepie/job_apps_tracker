import { RATING_IDS, RATING_LABELS } from "../domain";
import type { Application, RatingDimensionId } from "../domain";

/**
 * Preference is derived view state, never persisted: a score without the weights that
 * produced it is meaningless, so the weights live here and only the raw judgements are
 * stored. This is a separate axis from urgency and is never folded into it — see the note on
 * `preferenceFor` for why multiplying the two inverts the urgency ordering.
 */
export type RatingWeights = Record<RatingDimensionId, number>;

/** Equal until there is somewhere honest to persist a different policy. */
export const DEFAULT_RATING_WEIGHTS: Readonly<RatingWeights> = Object.freeze({
  work: 1,
  growth: 1,
  people: 1,
  company: 1,
});

/**
 * How much of a rating point unassessed and unknown dimensions can cost in total. Missing
 * information is risk — a known 4 beats a 4 with a blind spot — but it must stay a
 * refinement rather than a verdict, so the bound is `mean - MAX < score <= mean`. Because the
 * discount uses weight share, that bound holds for any number of dimensions.
 *
 * Note this deliberately does NOT mean a rating difference always wins: a mean gap smaller
 * than this can be overturned, and `5,-,-,-` (4.4375) losing to `5,5,4,4` (4.5) is intended.
 * Only a gap of MAX or more is guaranteed safe. This number is a guess until real use
 * corrects it.
 */
export const MAX_UNKNOWN_DISCOUNT = 0.75;

export interface PreferenceScore {
  /** On the 1-5 rating scale, discounted for what is not known. */
  score: number;
  /** The weakest judgement actually counted, so a mean cannot hide a dealbreaker. */
  lowest: { dimension: RatingDimensionId; score: number } | null;
  /** Assessed but unknowable: asked, and could not tell. */
  unknown: RatingDimensionId[];
  /** Never assessed. */
  unrated: RatingDimensionId[];
}

/** A negative weight would let the discount exceed its bound, so the scale starts at zero. */
function weightFor(weights: RatingWeights, dimension: RatingDimensionId): number {
  const weight = weights[dimension];
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

/**
 * Returns null when nothing that carries weight has been judged. Unrated is not the same as
 * bad, so callers must sort a null last in either direction rather than treating it as zero —
 * otherwise a fresh tracker is a wall of bottom-ranked rows and there is an incentive never
 * to rate anything.
 *
 * Never multiply this into an urgency score. Urgency already carries a stage factor of
 * 0.5-1.0; a second 0.5-1.0 factor compounds, and a deadline today on a poorly rated
 * application then loses to one ten days out that happens to be rated well.
 */
export function preferenceFor(
  application: Application,
  weights: RatingWeights = DEFAULT_RATING_WEIGHTS,
): PreferenceScore | null {
  const unknown: RatingDimensionId[] = [];
  const unrated: RatingDimensionId[] = [];
  let totalWeight = 0;
  let ratedWeight = 0;
  let weightedSum = 0;
  let lowest: PreferenceScore["lowest"] = null;

  for (const dimension of RATING_IDS) {
    const weight = weightFor(weights, dimension);
    totalWeight += weight;

    const rating = application.ratings.find((item) => item.dimension === dimension) ?? null;
    if (rating === null) {
      unrated.push(dimension);
      continue;
    }
    if (rating.score === null) {
      unknown.push(dimension);
      continue;
    }

    ratedWeight += weight;
    weightedSum += weight * rating.score;
    // Only dimensions the score actually counted can be a dealbreaker, so a zero-weighted
    // dimension stays out of this as well as out of the mean.
    if (weight > 0 && (lowest === null || rating.score < lowest.score)) {
      lowest = { dimension, score: rating.score };
    }
  }

  // Guard before dividing: this also covers every weight being zero.
  if (ratedWeight <= 0) return null;

  const mean = weightedSum / ratedWeight;
  const discount = MAX_UNKNOWN_DISCOUNT * ((totalWeight - ratedWeight) / totalWeight);

  return { score: mean - discount, lowest, unknown, unrated };
}

/** At or below this, a judgement is worth naming even when the mean looks healthy. */
export const DEALBREAKER_SCORE = 2;

/**
 * The one place preference phrasing is built, the way `describeDue` is the one place date
 * phrasing is built, so the table column and the Kanban card cannot describe the same
 * ratings differently. The score itself stays free of any threshold: this is where the
 * decision to name a weak judgement lives.
 *
 * A bare number hides too much. 5,5,5,1 and 4,4,4,4 both average 4.00, and a high mean over
 * one rated dimension is not a high mean over four, so the text names the weakest judgement
 * and what is still missing.
 */
export function describePreference(preference: PreferenceScore | null): string {
  if (!preference) return "";

  const { score, lowest, unknown, unrated } = preference;
  const parts = [score.toFixed(2)];

  if (lowest && lowest.score <= DEALBREAKER_SCORE) {
    parts.push(`${RATING_LABELS[lowest.dimension]} ${lowest.score}`);
  }
  if (unknown.length > 0) {
    parts.push(`${unknown.map((dimension) => RATING_LABELS[dimension]).join(", ")} unknown`);
  }
  if (unrated.length > 0) parts.push(`${unrated.length} not rated`);

  return parts.join(" · ");
}

export interface PreferenceDimensionSummary {
  dimension: RatingDimensionId;
  /** Judged 1-5. */
  judged: number;
  /** Asked, and could not tell. */
  unknown: number;
  /** Never assessed. */
  unassessed: number;
  /** Plain mean of the judged scores, or null when this dimension holds none. */
  mean: number | null;
}

export interface PreferenceSummary {
  /** Applications in the collection, so `rated` reads as a share rather than a bare count. */
  total: number;
  /** Applications carrying at least one judgement the score could count. */
  rated: number;
  /** Mean preference across the rated applications, or null when none are rated. */
  mean: number | null;
  /** One row per configured dimension, in `RATING_CONFIG` order. */
  dimensions: PreferenceDimensionSummary[];
}

/**
 * How a whole collection was judged, which is the one thing a per-row score cannot say:
 * whether a dimension reads low because you keep rating it low, or because you have never
 * assessed it. Derived like every other statistic, and never persisted.
 *
 * The per-dimension rows count what was recorded, so a dimension weighted zero still reports
 * its judgements even though no score counted them. Only `rated` and `mean` follow the
 * weights, because those come from `preferenceFor`.
 */
export function preferenceSummary(
  applications: Application[],
  weights: RatingWeights = DEFAULT_RATING_WEIGHTS,
): PreferenceSummary {
  const dimensions = RATING_IDS.map((dimension) => {
    const summary: PreferenceDimensionSummary = {
      dimension,
      judged: 0,
      unknown: 0,
      unassessed: 0,
      mean: null,
    };
    let judgedSum = 0;

    for (const application of applications) {
      const rating = application.ratings.find((item) => item.dimension === dimension) ?? null;
      if (rating === null) {
        summary.unassessed += 1;
      } else if (rating.score === null) {
        summary.unknown += 1;
      } else {
        summary.judged += 1;
        judgedSum += rating.score;
      }
    }

    if (summary.judged > 0) summary.mean = judgedSum / summary.judged;
    return summary;
  });

  const scores = applications
    .map((application) => preferenceFor(application, weights))
    .filter((preference): preference is PreferenceScore => preference !== null)
    .map(({ score }) => score);

  return {
    total: applications.length,
    rated: scores.length,
    mean: scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    dimensions,
  };
}
