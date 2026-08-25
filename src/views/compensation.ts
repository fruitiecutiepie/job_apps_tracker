import {
  COMPENSATION_CONFIG,
  COMPENSATION_STAGE_IDS,
  bandMidpoint,
  formatCompensationAmount,
  isPointValue,
  parseTypedAmount,
} from "../domain";
import type { Application, CompensationBand, CompensationStageId } from "../domain";

/**
 * How a recorded pay figure reads against the target, derived here and never persisted for
 * the same reason as urgency and preference: the comparison is a policy — which figure counts
 * as *the* figure, and whether a band that straddles the target is short or not — and a bare
 * number without the policy that produced it is meaningless. Only the figures themselves are
 * stored.
 *
 * Unlike preference this is not a score and carries no weights. Compensation is a
 * measurement: the numbers are already comparable, so nothing here invents a scale.
 */

/** The figure the employer named: an offer when there is one, otherwise the posting. */
export interface CompensationFigure {
  stage: Extract<CompensationStageId, "advertised" | "offered">;
  band: CompensationBand;
  currency: string;
}

export type CompensationVerdict = "above" | "within" | "below";

export interface CompensationGap {
  figure: CompensationFigure;
  /** The `expected` band: what you are aiming for at this employer. */
  target: CompensationBand;
  /**
   * Band-aware, so "130-150k against a 145k target" is not reported as short: it is
   * undecided. `below` means the figure cannot reach the target at all, `above` means it
   * clears the whole of it, and `within` means the two overlap.
   */
  verdict: CompensationVerdict;
  /**
   * The gap that holds whatever the bands settle on, measured between their nearest ends, so
   * an overlap is exactly zero rather than a midpoint artefact. Negative below target.
   */
  difference: number;
  /** `difference` as a share of the target end it was measured from. */
  share: number;
}

/**
 * `expected` is deliberately excluded: it is your target, not a number anyone offered you, so
 * an application holding only an expectation has no figure at all. Returns null when nothing
 * was quoted — callers must sort a null last in either direction rather than as the lowest
 * pay, the same way an unrated application is not the worst-rated one.
 */
export function compensationFigureFor(application: Application): CompensationFigure | null {
  const { currency, advertised, offered } = application.compensation;
  if (!currency) return null;

  if (offered) return { stage: "offered", band: offered, currency };
  if (advertised) return { stage: "advertised", band: advertised, currency };
  return null;
}

/** Null when there is nothing quoted, or no target to measure it against. */
export function compensationGapFor(application: Application): CompensationGap | null {
  const figure = compensationFigureFor(application);
  const target = application.compensation.expected;
  if (!figure || !target) return null;

  if (figure.band.max < target.min) {
    const difference = figure.band.max - target.min;
    return { figure, target, verdict: "below", difference, share: difference / target.min };
  }
  if (figure.band.min > target.max) {
    const difference = figure.band.min - target.max;
    return { figure, target, verdict: "above", difference, share: difference / target.max };
  }
  return { figure, target, verdict: "within", difference: 0, share: 0 };
}

/** A point value reads as one number; only a real band shows both ends. */
export function formatCompensationBand(band: CompensationBand): string {
  return isPointValue(band)
    ? formatCompensationAmount(band.min)
    : `${formatCompensationAmount(band.min)}–${formatCompensationAmount(band.max)}`;
}

export function describeCompensationGap(gap: CompensationGap): string {
  if (gap.verdict === "within") return "within target";

  const percent = Math.round(Math.abs(gap.share) * 100);
  // Rounding to nothing would otherwise print "0% above target", which reads as on target.
  return percent === 0 ? `just ${gap.verdict} target` : `${percent}% ${gap.verdict} target`;
}

/**
 * The progression, in the order the stages arrive, with the currency stated once at the front
 * because one application is one employer talking about one salary. The gap comes last, and
 * needs no stage name: it always describes the highest stage listed.
 */
export function compensationText(application: Application): string {
  const { compensation } = application;
  if (!compensation.currency) return "";

  const parts: string[] = [compensation.currency];
  for (const { id, label } of COMPENSATION_CONFIG) {
    const band = compensation[id];
    if (band) parts.push(`${label} ${formatCompensationBand(band)}`);
  }

  const gap = compensationGapFor(application);
  if (gap) parts.push(describeCompensationGap(gap));

  return parts.join(" · ");
}

/**
 * The single number a table column sorts by: the midpoint of the quoted figure. Null when
 * nothing was quoted.
 *
 * This ignores currency, because there is nowhere to persist conversion rates and inventing
 * them would be worse than the alternative. A tracker mixing currencies must read the column
 * rather than trust its order — which is why the currency is the first thing every cell says.
 */
export function compensationSortValue(application: Application): number | null {
  const figure = compensationFigureFor(application);
  return figure ? bandMidpoint(figure.band) : null;
}


/** Which stage a range filter checks: one named stage, or "any" of the three. */
export type CompensationFilterStage = CompensationStageId | "any";

/**
 * A typed min/max range, kept as the raw box text rather than parsed numbers: the filter is
 * display state that lives in the table, and re-parsing on every match keeps this the only
 * place that has to agree with the boxes about what counts as a number.
 */
export interface CompensationRangeFilter {
  stage: CompensationFilterStage;
  min: string;
  max: string;
}

function filterBound(text: string): number | null {
  const amount = parseTypedAmount(text);
  // Unparseable text is treated as no bound rather than as an error: a filter that hides
  // every row while a number is half-typed would be worse than one that briefly ignores it.
  return amount === null || Number.isNaN(amount) ? null : amount;
}

/**
 * Whether an application's recorded pay could satisfy a typed range. This checks overlap
 * against the relevant band, not containment: a query for 120,000 to 150,000 should catch a
 * 100,000-130,000 band, the same way `compensationGapFor` treats an overlapping band as
 * "within target" rather than short — one policy for what "a band matches a number" means,
 * used both places.
 *
 * A row with no band for the selected stage never matches: silence is not an answer to a
 * question about a number, the same reason `compensationSortValue` returns `null` for it
 * rather than a sentinel.
 */
export function matchesCompensationRange(
  application: Application,
  filter: CompensationRangeFilter,
): boolean {
  const min = filterBound(filter.min);
  const max = filterBound(filter.max);
  if (min === null && max === null) return true;

  const stages = filter.stage === "any" ? COMPENSATION_STAGE_IDS : [filter.stage];
  return stages.some((stage) => {
    const band = application.compensation[stage];
    if (!band) return false;
    if (min !== null && band.max < min) return false;
    if (max !== null && band.min > max) return false;
    return true;
  });
}
