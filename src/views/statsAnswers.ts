import { RATING_LABELS, classifyLifecycle, stateLabel } from "../domain";
import type { Application, StateId } from "../domain";
import { compensationFigureFor, compensationGapFor } from "./compensation";
import type { CompensationGap, CompensationVerdict } from "./compensation";
import { idleStatusFor } from "./idle";
import { median } from "./outcomes";
import { stageMoveKind } from "./outcomes";
import type {
  FinishDurations,
  StageMove,
  ReplyWaits,
  SourceOutcomeRow,
  StagePassRow,
  WeekActivity,
} from "./outcomes";
import type { PreferenceSummary } from "./preference";

/**
 * The sentence each Statistics card leads with. The chart under it is the evidence; this
 * is the answer, worked out so the reader does not have to.
 *
 * Every sentence is built here and nowhere else, the way `describeDue` is the only place
 * date phrasing is built, so the tests can hold the wording and two cards cannot phrase
 * the same fact differently. Small numbers are said as counts ("2 of 3") and never as
 * percentages, which would sound surer than three applications can be.
 */

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function days(count: number): string {
  return plural(count, "day");
}

/** "12", "12 and 30", "12, 15 and 30" — for the few values a median would misrepresent. */
function listed(values: number[]): string {
  const sorted = [...values].sort((left, right) => left - right).map(String);
  if (sorted.length <= 1) return sorted.join("");
  return `${sorted.slice(0, -1).join(", ")} and ${sorted.at(-1)}`;
}

/** Below this many values a median is replaced by the values themselves. */
export const LIST_BELOW = 5;

// ------------------------------------------------------------------ answering ---

export interface ReplyBucket {
  id: string;
  label: string;
  count: number;
}

const REPLY_BUCKETS = [
  { id: "week", label: "Under a week", max: 6 },
  { id: "fortnight", label: "1–2 weeks", max: 13 },
  { id: "month", label: "2–4 weeks", max: 29 },
  { id: "later", label: "A month or more", max: Infinity },
] as const;

export function replyBuckets(waits: ReplyWaits): ReplyBucket[] {
  return REPLY_BUCKETS.map((bucket, index) => {
    const floor = index === 0 ? 0 : REPLY_BUCKETS[index - 1]!.max + 1;
    return {
      id: bucket.id,
      label: bucket.label,
      count: waits.replied.filter((value) => value >= floor && value <= bucket.max).length,
    };
  });
}

export function answeringAnswer(total: number, waits: ReplyWaits): string {
  const heard = waits.replied.length;
  if (heard === 0) return "Nobody has replied yet.";

  const wait = median(waits.replied)!;
  // The median is the lower middle, so at least half replied within it — "half" is honest.
  const within = wait === 0 ? "the same day" : `within ${days(wait)}`;
  return `${heard} of ${total} heard back. Half of them ${within}.`;
}

// ------------------------------------------------------------------- losing ---

export interface LosingAnswer {
  answer: string;
  /** The stage the answer names, or null when it names none. */
  worst: StateId | null;
}

/**
 * Names the stage with the lowest pass rate among the ones with enough decided
 * applications to compare, earliest first on a tie. A stage below the minimum is never
 * named, so one bad week at Offer cannot read as the problem with the whole search.
 */
export function losingAnswer(rows: StagePassRow[], minimum: number): LosingAnswer {
  if (rows.length === 0) {
    return { answer: "No application has reached a live stage yet.", worst: null };
  }

  const comparable = rows.filter((row) => row.decided >= minimum);
  if (comparable.length === 0) {
    return {
      answer: `Too few decided applications to say where you lose the most yet. A stage needs ${minimum} before it's compared.`,
      worst: null,
    };
  }

  const rate = (row: StagePassRow) => row.passed / row.decided;
  const worst = comparable.reduce((lowest, row) => (rate(row) < rate(lowest) ? row : lowest));
  const lost = worst.decided - worst.passed;
  if (lost === 0) {
    return {
      answer: "Nothing has stalled yet: every decided application got past its stage.",
      worst: null,
    };
  }

  return {
    answer: `You lose the most at ${stateLabel(worst.state)}: ${lost} of ${worst.decided} went no further.`,
    worst: worst.state,
  };
}

// -------------------------------------------------------------------- moves ---

/** What the recorded moves amounted to, in the three kinds the flow diagram colours. */
export function movesAnswer(moves: StageMove[]): string {
  const total = moves.reduce((sum, move) => sum + move.count, 0);
  if (total === 0) return "No application has moved yet.";
  const count = (kind: ReturnType<typeof stageMoveKind>) =>
    moves.filter((move) => stageMoveKind(move) === kind).reduce((sum, move) => sum + move.count, 0);
  return `Of ${plural(total, "recorded move")}, ${count("further")} went to a later stage and ${count("rejected")} to a rejection.`;
}

// ----------------------------------------------------------------- ghosting ---

export interface QuietApplication {
  application: Application;
  days: number;
}

/** Live applications at or past the quiet threshold, longest silence first. */
export function quietApplications(
  applications: Application[],
  quietDays: number,
  today: Date = new Date(),
): QuietApplication[] {
  return applications
    .map((application) => ({ application, status: idleStatusFor(application, today, quietDays) }))
    .filter((entry): entry is { application: Application; status: { days: number } } => entry.status !== null)
    .map(({ application, status }) => ({ application, days: status.days }))
    .sort(
      (left, right) =>
        right.days - left.days || left.application.company.localeCompare(right.application.company),
    );
}

export function ghostingAnswer(quiet: QuietApplication[], quietDays: number): string {
  if (quiet.length === 0) {
    return `Nothing live has gone ${days(quietDays)} without a stage change.`;
  }
  const verb = quiet.length === 1 ? "has" : "have";
  return `${plural(quiet.length, "live application")} ${verb} had no stage change for ${days(quietDays)} or more.`;
}

// ------------------------------------------------------------------ sources ---

export function sourceLabel(source: string | null): string {
  return source ?? "Not recorded";
}

export interface RankedSources {
  /** Sources with enough applications to compare, furthest-getting first. */
  comparable: SourceOutcomeRow[];
  /** The rest, too few to rank, in the order they were given. */
  tooFew: SourceOutcomeRow[];
}

/**
 * Ranked by the share that got past the first stage, then by the share that heard back,
 * then by volume. Only sources at the minimum are ranked: below it, one application that
 * went anywhere is 100% and would sort first, which is the trap a rate on a small count
 * sets.
 */
export function rankSources(rows: SourceOutcomeRow[], minimum: number): RankedSources {
  const share = (count: number, row: SourceOutcomeRow) => count / row.total;
  const comparable = rows
    .filter((row) => row.total >= minimum)
    .sort(
      (left, right) =>
        share(right.advanced, right) - share(left.advanced, left) ||
        share(right.heardBack, right) - share(left.heardBack, left) ||
        right.total - left.total ||
        sourceLabel(left.source).localeCompare(sourceLabel(right.source)),
    );
  return { comparable, tooFew: rows.filter((row) => row.total < minimum) };
}

export function sourcesAnswer(ranked: RankedSources, minimum: number): string {
  const { comparable } = ranked;
  if (comparable.length === 0) {
    return `No source has ${plural(minimum, "application")} yet, too few to compare.`;
  }
  if (comparable.length === 1) {
    return `Only ${sourceLabel(comparable[0]!.source)} has ${plural(minimum, "application")} or more, so there's nothing to compare it with yet.`;
  }

  const [best, next] = comparable as [SourceOutcomeRow, SourceOutcomeRow];
  if (best.advanced * next.total === next.advanced * best.total) {
    const percent = Math.round((best.advanced / best.total) * 100);
    return `${sourceLabel(best.source)} and ${sourceLabel(next.source)} tie for furthest, with ${percent}% of each past the first stage.`;
  }
  return `${sourceLabel(best.source)} got furthest: ${best.advanced} of ${best.total} past the first stage.`;
}

// ----------------------------------------------------------------- momentum ---

/** The four weeks before this one, as the baseline this week is read against. */
export const MOMENTUM_BASELINE_WEEKS = 4;

export const WEEK_FORMAT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

export function weekLabel(week: WeekActivity): string {
  return `Week of ${WEEK_FORMAT.format(week.start)}`;
}

function average(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function momentumAnswer(weeks: WeekActivity[]): string {
  const current = weeks.at(-1);
  if (!current) return "";
  const before = weeks.slice(-1 - MOMENTUM_BASELINE_WEEKS, -1);
  const baseline = before.reduce((sum, week) => sum + week.started, 0) / Math.max(1, before.length);

  if (current.started === 0 && baseline === 0) {
    return `No new applications in the last ${before.length + 1} weeks.`;
  }
  const thisWeek = `This week: ${plural(current.started, "application")}, ${plural(current.replies, "reply", "replies")}.`;
  return `${thisWeek} The ${before.length} weeks before averaged ${average(baseline)} a week.`;
}

export function liveCount(applications: Application[]): number {
  return applications.filter((application) => classifyLifecycle(application) === "live").length;
}

// ---------------------------------------------------------------- durations ---

function durationPart(values: number[], one: string, many: string): string | null {
  if (values.length === 0) return null;
  if (values.length < LIST_BELOW) {
    const subject = values.length === 1 ? `Your one ${one}` : `Your ${values.length} ${many}`;
    return `${subject} took ${listed(values)} days`;
  }
  const capital = many.charAt(0).toUpperCase() + many.slice(1);
  return `${capital} took ${days(median(values)!)} at the median`;
}

export function durationsAnswer(durations: FinishDurations): string {
  const parts = [
    durationPart(durations.toOffer, "offer", "offers"),
    durationPart(durations.toRejection, "rejection", "rejections"),
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return "Nothing has reached an offer or a rejection yet.";
  return `${parts.join(". ")}.`;
}

// -------------------------------------------------------------------- money ---

export interface PayRow {
  application: Application;
  gap: CompensationGap | null;
}

export interface MoneyAnswer {
  answer: string;
  /** What the answer was worked out from: the offers, or failing those the postings. */
  rows: PayRow[];
  kind: "offers" | "postings" | "none";
}

const VERDICT_ORDER: CompensationVerdict[] = ["above", "within", "below"];

function verdictCounts(rows: PayRow[]): string {
  const parts = VERDICT_ORDER.map((verdict) => [verdict, rows.filter((row) => row.gap?.verdict === verdict).length] as const)
    .filter(([, count]) => count > 0)
    .map(([verdict, count]) => `${count} ${verdict} target`);
  const untargeted = rows.filter((row) => row.gap === null).length;
  if (untargeted > 0) parts.push(`${untargeted} with no target to compare`);
  return parts.join(", ");
}

/**
 * Offers first, since an offer is the number that decides anything. With none, the
 * advertised pay on live applications is the honest next best — clearly labelled as
 * postings, because a posting is not a figure anyone has said they will pay you.
 */
export function moneyAnswer(applications: Application[]): MoneyAnswer {
  const offers = applications
    .filter((application) => compensationFigureFor(application)?.stage === "offered")
    .map((application) => ({ application, gap: compensationGapFor(application) }));
  if (offers.length > 0) {
    return { answer: `${plural(offers.length, "offer")}: ${verdictCounts(offers)}.`, rows: offers, kind: "offers" };
  }

  const postings = applications
    .filter((application) => classifyLifecycle(application) === "live")
    .map((application) => ({ application, gap: compensationGapFor(application) }))
    .filter((row) => row.gap !== null);
  if (postings.length > 0) {
    return {
      answer: `No offers yet. Advertised pay on live applications: ${verdictCounts(postings)}.`,
      rows: postings,
      kind: "postings",
    };
  }

  return {
    answer: "No offers yet, and no advertised pay with a target to compare it against.",
    rows: [],
    kind: "none",
  };
}

// ------------------------------------------------------------------ ratings ---

export function ratingsAnswer(preference: PreferenceSummary, formatMean: (mean: number | null) => string): string {
  if (preference.rated === 0) return "No application has been rated yet.";
  const judged = preference.dimensions.filter((dimension) => dimension.mean !== null);
  // "Lowest" needs something to be lower than.
  const lowest = judged.length < 2 ? null : judged
    .reduce<PreferenceSummary["dimensions"][number] | null>(
      (low, dimension) => (low === null || dimension.mean! < low.mean! ? dimension : low),
      null,
    );
  const rated = `${preference.rated} of ${preference.total} rated, mean preference ${formatMean(preference.mean)}.`;
  return lowest ? `${rated} ${RATING_LABELS[lowest.dimension]} scores lowest.` : rated;
}
