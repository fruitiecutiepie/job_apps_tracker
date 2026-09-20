import { classifyLifecycle } from "../domain";
import type { Application } from "../domain";
import type { PreferenceScore } from "./preference";
import { SCORE_EPSILON, daysUntil, type UrgencyRanking } from "./urgency";
import { upcomingStateEvent } from "./viewUtils";

/**
 * A coarse reading of the urgency ranking, for banding a sorted table.
 *
 * The bands are deliberately few. A band exists to tell you where to start and where it
 * stops mattering; it does not need to restate the Urgency column, which already says
 * "Action overdue 3 days" or "No stage change in 12 days" on the row itself. Finer
 * headings were worth having when the same rows were rendered as cards with no columns
 * to read.
 */
export type UrgencyBandId = "due" | "undated" | "outstanding" | "closed";

export interface UrgencyBand {
  id: UrgencyBandId;
  /**
   * States the band's own membership test, and for `due` its order as well, because a
   * dated band reads by date rather than by score. See `compareWithinBand`.
   */
  heading: string;
}

export const URGENCY_BANDS: readonly UrgencyBand[] = [
  { id: "due", heading: "Dated, soonest first" },
  { id: "undated", heading: "Live, nothing dated" },
  { id: "outstanding", heading: "Finished, action outstanding" },
  { id: "closed", heading: "Finished" },
];

const BAND_ORDER = new Map<UrgencyBandId, number>(
  URGENCY_BANDS.map(({ id }, index) => [id, index]),
);

export function bandRank(band: UrgencyBandId): number {
  return BAND_ORDER.get(band) ?? URGENCY_BANDS.length;
}

export interface BandPlacement {
  band: UrgencyBandId;
  /** Days to the driving date, or null where the band has no date to order by. */
  days: number | null;
}

/**
 * The nearest dated commitment, whichever field it came from. Placement uses the date
 * itself rather than the winning pressure, because pressure decays to zero past its horizon
 * and an action dated ten days out is still dated.
 */
function drivingDays(application: Application, today: Date): number | null {
  const candidates: number[] = [];

  const invite = upcomingStateEvent(application, today);
  if (invite) {
    const days = daysUntil(invite.starts_at, today);
    if (days !== null) candidates.push(days);
  }
  if (application.deadline_at) {
    const days = daysUntil(application.deadline_at, today);
    if (days !== null) candidates.push(days);
  }
  if (application.next_action?.trim() && application.next_action_at) {
    const days = daysUntil(application.next_action_at, today);
    if (days !== null) candidates.push(days);
  }

  return candidates.length === 0 ? null : Math.min(...candidates);
}

/**
 * Which band a row falls in. Every application lands in exactly one, including the
 * finished ones the urgency ranking never scores: a task left on a rejected application
 * is still a task, so it gets a band of its own rather than disappearing among the rest.
 */
export function urgencyBandFor(
  application: Application,
  today: Date = new Date(),
): BandPlacement {
  if (classifyLifecycle(application.state) !== "live") {
    return {
      band: application.next_action?.trim() ? "outstanding" : "closed",
      days: null,
    };
  }

  const days = drivingDays(application, today);
  return days === null ? { band: "undated", days: null } : { band: "due", days };
}

/**
 * The order inside a banded table: band first, then the band's own rule, then the urgency
 * score, then preference, then company so the comparison is total.
 *
 * A dated band reads by date rather than by score, which is what its heading says. The two
 * disagree because each pressure decays over its own horizon, so an invite three weeks out
 * can outscore a deadline next week; in a band that promises "soonest first", the date is
 * the honest reading. Everywhere else the score decides, unchanged.
 *
 * Preference is never added to or multiplied into the score and cannot overturn it. It
 * speaks only where the score has already tied, where the fallback would otherwise be an
 * arbitrary input order. A null sinks in both directions, the way the Preference column
 * treats one, because never rated is not the same as rated badly.
 */
export function compareBanded(
  left: Application,
  right: Application,
  bands: ReadonlyMap<string, BandPlacement>,
  urgency: ReadonlyMap<string, UrgencyRanking>,
  preference: ReadonlyMap<string, PreferenceScore>,
): number {
  const leftBand = bands.get(left.id)!;
  const rightBand = bands.get(right.id)!;

  const byBand = bandRank(leftBand.band) - bandRank(rightBand.band);
  if (byBand !== 0) return byBand;

  if (leftBand.days !== null && rightBand.days !== null && leftBand.days !== rightBand.days) {
    return leftBand.days - rightBand.days;
  }

  const leftScore = urgency.get(left.id)?.score ?? 0;
  const rightScore = urgency.get(right.id)?.score ?? 0;
  if (Math.abs(leftScore - rightScore) > SCORE_EPSILON) return rightScore - leftScore;

  const leftPreference = preference.get(left.id)?.score ?? null;
  const rightPreference = preference.get(right.id)?.score ?? null;
  if (leftPreference !== rightPreference) {
    if (leftPreference === null) return 1;
    if (rightPreference === null) return -1;
    return rightPreference - leftPreference;
  }

  return left.company.localeCompare(right.company);
}
