import { FINAL_STAGE, OUTCOME_IDS, classifyLifecycle, stageRank } from "../domain";
import type { Application, StageId, Status } from "../domain";
import { localDayNumber, parseTimestamp } from "./viewUtils";

/**
 * What a collection of applications says about the search itself, rather than about any
 * one application in it.
 *
 * Everything here reads `stage_history`, which is the only record of what actually
 * happened: `updated_at` moves when you annotate a row, and the current stage alone cannot
 * say how far something got before it ended. None of it is persisted — these are counts
 * over the document, derived on render like every other view value.
 *
 * Progress is read off the stage alone, in `STAGE_CONFIG` order: being turned down changes
 * the outcome and leaves the stage where it was, so it is never progress, and reaching
 * Accepted — the last stage — is the furthest an application can get.
 */

/** Ordered oldest first, so the first entry is where the application started. */
function historyInOrder(application: Application) {
  return [...application.stage_history].sort((left, right) => left.at.localeCompare(right.at));
}

/**
 * Whether anything was recorded after the stage and outcome the application started in.
 *
 * This is the closest honest reading of "did they reply" the document supports, and it is
 * named for what it measures rather than for what it is used as: a second recorded stage
 * is a second recorded stage. It counts a rejection, because a rejection is a reply. It
 * does not count an application filed straight into a rejected stage, which has one entry
 * and never had a first reply to measure.
 */
export function heardBack(application: Application): boolean {
  return application.stage_history.length > 1;
}

/**
 * Days from the starting stage to whatever was recorded next, or null if nothing was.
 *
 * Counted in browser-local calendar days like every other span in the app, so two moves on
 * one day read as 0 rather than as a fraction.
 */
export function daysToFirstReply(application: Application): number | null {
  const history = historyInOrder(application);
  if (history.length < 2) return null;

  const started = parseTimestamp(history[0]!.at);
  const replied = parseTimestamp(history[1]!.at);
  if (!started || !replied) return null;

  return Math.max(0, localDayNumber(replied) - localDayNumber(started));
}

/**
 * Whether the application ever reached a stage later than the one it started in.
 *
 * Stage order comes from `STAGE_CONFIG`, so a move that skips stages still counts and a
 * move backwards does not. Being turned down is not progress — it changes the outcome and
 * leaves the stage — which is what separates this from `heardBack`.
 */
export function advanced(application: Application): boolean {
  const history = historyInOrder(application);
  const first = history[0];
  if (!first) return false;
  const start = stageRank(first.stage);

  return history.slice(1).some((entry) => stageRank(entry.stage) > start);
}

/** Where a move left or landed: a stage, and how it was going there. */
export type MoveEnd = Status;

export interface StageMove {
  from: MoveEnd;
  to: MoveEnd;
  /** How many times this move was recorded, across every application. */
  count: number;
}

/**
 * Every move recorded in `stage_history`, grouped by where it left and where it landed.
 *
 * This is what `movedOn` cannot say: any stage may move to any other, so "moved on" from
 * a stage covers going further, going back, and being turned down, and only the history
 * itself says which. Each consecutive pair of entries is one move — a change of stage, of
 * outcome, or of both — so an application that went back and forth between two stages
 * counts each crossing. Ordered by stage, then outcome, on both ends, which is the order
 * they are read in everywhere else.
 */
export function stageMoves(applications: Application[]): StageMove[] {
  const moves = new Map<string, StageMove>();

  for (const application of applications) {
    const history = historyInOrder(application);
    for (let index = 1; index < history.length; index += 1) {
      const previous = history[index - 1]!;
      const next = history[index]!;
      const from = { stage: previous.stage, outcome: previous.outcome };
      const to = { stage: next.stage, outcome: next.outcome };
      if (from.stage === to.stage && from.outcome === to.outcome) continue;
      const key = moveKey({ from, to });
      const move = moves.get(key) ?? { from, to, count: 0 };
      move.count += 1;
      moves.set(key, move);
    }
  }

  return [...moves.values()].sort(
    (left, right) => order(left.from) - order(right.from) || order(left.to) - order(right.to),
  );
}

const order = ({ stage, outcome }: MoveEnd) => stageRank(stage) * OUTCOME_IDS.length + OUTCOME_IDS.indexOf(outcome);

/** One move's identity, for grouping and for a row's key. */
export function moveKey({ from, to }: Pick<StageMove, "from" | "to">): string {
  return `${from.stage}:${from.outcome}>${to.stage}:${to.outcome}`;
}

export type StageMoveKind = "further" | "rejected" | "other";

/**
 * What a move amounted to: into a rejection, on to a later stage, or anything else — going
 * back, withdrawing, the employer closing it, reopening. The same reading of stage order
 * `advanced` uses, so the two cannot disagree about progress.
 */
export function stageMoveKind(move: Pick<StageMove, "from" | "to">): StageMoveKind {
  if (move.to.outcome === "rejected" && move.from.outcome !== "rejected") return "rejected";
  if (stageRank(move.to.stage) > stageRank(move.from.stage)) return "further";
  return "other";
}

export interface SourceOutcomeRow {
  /** The recorded source, or null where none was. */
  source: string | null;
  total: number;
  heardBack: number;
  advanced: number;
}

/**
 * How each source has actually worked out. Sources are compared by their stored text, so
 * "LinkedIn" and "linkedin" are two sources: canonicalizing them here would be a guess
 * about what you meant, and the editor is where that belongs.
 */
export function sourceOutcomes(applications: Application[]): SourceOutcomeRow[] {
  const rows = new Map<string, SourceOutcomeRow>();

  for (const application of applications) {
    const source = application.source?.trim() || null;
    const key = source ?? "";
    const row = rows.get(key) ?? { source, total: 0, heardBack: 0, advanced: 0 };
    row.total += 1;
    if (heardBack(application)) row.heardBack += 1;
    if (advanced(application)) row.advanced += 1;
    rows.set(key, row);
  }

  return [...rows.values()].sort((left, right) => {
    if (left.total !== right.total) return right.total - left.total;
    // A stable, readable order among equals, with the unrecorded source last.
    if (left.source === null) return 1;
    if (right.source === null) return -1;
    return left.source.localeCompare(right.source);
  });
}


export interface StagePassRow {
  stage: StageId;
  /** Reached the stage and are no longer sitting in it: the ones it has an answer for. */
  decided: number;
  /** Of those, the ones that went on to a later stage, Accepted included. */
  passed: number;
  /** Sitting in it now, so it is too soon to say whether they will pass it. */
  pending: number;
}

/**
 * For each stage short of Accepted: of the applications that reached it and have since been
 * decided, how many got past it.
 *
 * Two choices make this a pass rate rather than a count. Applications still in the stage
 * are left out of it, because counting them as losses would make every stage look worse
 * than it is the moment anything new arrives. And passing means reaching any later stage,
 * not the next one in the list: not every process has a take-home, so an application that
 * skipped one still passed the stage before it. Accepted is the stage after Offer, so
 * taking a job passes every stage before it; it gets no row of its own, nothing coming
 * after it to pass to.
 */
export function stagePassRates(applications: Application[]): StagePassRow[] {
  const rows = new Map<StageId, StagePassRow>();

  for (const application of applications) {
    const history = historyInOrder(application);
    const seen = new Set<StageId>();

    history.forEach((entry, index) => {
      if (entry.stage === FINAL_STAGE || seen.has(entry.stage)) return;
      seen.add(entry.stage);
      const rank = stageRank(entry.stage);

      const row = rows.get(entry.stage) ?? { stage: entry.stage, decided: 0, passed: 0, pending: 0 };
      const passed = history.slice(index + 1).some((later) => stageRank(later.stage) > rank);
      if (passed) {
        row.decided += 1;
        row.passed += 1;
      } else if (application.stage === entry.stage && application.outcome === "active") {
        row.pending += 1;
      } else {
        row.decided += 1;
      }
      rows.set(entry.stage, row);
    });
  }

  return [...rows.values()].sort((left, right) => stageRank(left.stage) - stageRank(right.stage));
}

export interface ReplyWaits {
  /** Days to the first reply, one per application that has had one. */
  replied: number[];
  /** Live applications that have heard nothing at all yet. */
  waiting: number;
}

export function replyWaits(applications: Application[]): ReplyWaits {
  const replied: number[] = [];
  let waiting = 0;
  for (const application of applications) {
    const days = daysToFirstReply(application);
    if (days !== null) replied.push(days);
    else if (classifyLifecycle(application) === "live") waiting += 1;
  }
  return { replied, waiting };
}

export interface WeekActivity {
  /** Local midnight on the Monday the week starts. */
  start: Date;
  /** Applications whose first recorded stage falls in the week. */
  started: number;
  /** First replies that arrived in the week, whenever their application started. */
  replies: number;
}

/**
 * The last `weeks` weeks, oldest first, ending with the one holding `today`. Weeks start on
 * Monday and are counted in browser-local days like every other span in the app. An
 * application is counted in the week of its first history entry, and its reply in the week
 * of its second, so a week shows what happened in it rather than what was filed then.
 */
export function weeklyActivity(
  applications: Application[],
  today: Date = new Date(),
  weeks = 12,
): WeekActivity[] {
  const weekday = (today.getDay() + 6) % 7;
  const monday = localDayNumber(today) - weekday;
  const rows: WeekActivity[] = Array.from({ length: weeks }, (_, index) => {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - weekday);
    start.setDate(start.getDate() - (weeks - 1 - index) * 7);
    return { start, started: 0, replies: 0 };
  });

  const slot = (value: string | undefined): WeekActivity | null => {
    const date = value ? parseTimestamp(value) : null;
    if (!date) return null;
    const offset = Math.floor((localDayNumber(date) - monday) / 7);
    return offset > 0 || offset <= -weeks ? null : rows[weeks - 1 + offset]!;
  };

  for (const application of applications) {
    const history = historyInOrder(application);
    const started = slot(history[0]?.at);
    if (started) started.started += 1;
    const replied = slot(history[1]?.at);
    if (replied) replied.replies += 1;
  }

  return rows;
}

export interface FinishDurations {
  /** Days from the first recorded stage to the rejection, per rejected application. */
  toRejection: number[];
  /** Days from the first recorded stage to first reaching Offer, per application that did. */
  toOffer: number[];
}

/**
 * How long the process took, for the applications that have an answer. A rejection is
 * timed to the entry that put the application where it is now; an offer to the first time
 * Offer was reached, whether or not it was accepted, since "how long until an offer" is
 * the planning question and what came after it is a separate decision.
 */
export function finishDurations(applications: Application[]): FinishDurations {
  const span = (from: string | undefined, to: string | undefined): number | null => {
    const start = from ? parseTimestamp(from) : null;
    const end = to ? parseTimestamp(to) : null;
    return start && end ? Math.max(0, localDayNumber(end) - localDayNumber(start)) : null;
  };

  const toRejection: number[] = [];
  const toOffer: number[] = [];
  for (const application of applications) {
    const history = historyInOrder(application);
    if (application.outcome === "rejected") {
      const days = span(history[0]?.at, history.at(-1)?.at);
      if (days !== null) toRejection.push(days);
    }
    const offer = history.find((entry) => entry.stage === "offer");
    if (offer) {
      const days = span(history[0]?.at, offer.at);
      if (days !== null) toOffer.push(days);
    }
  }
  return { toRejection, toOffer };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  // The lower of the two middles on an even count, so the figure is always one an
  // application actually took rather than a half-day nothing waited.
  return sorted.length % 2 === 0 ? sorted[middle - 1]! : sorted[middle]!;
}
