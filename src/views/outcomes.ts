import { LIVE_STATE_IDS, STATE_IDS, classifyLifecycle, isRejectedState } from "../domain";
import type { Application, StateId } from "../domain";
import { localDayNumber, parseTimestamp } from "./viewUtils";

/**
 * What a collection of applications says about the search itself, rather than about any
 * one application in it.
 *
 * Everything here reads `state_history`, which is the only record of what actually
 * happened: `updated_at` moves when you annotate a row, and the current state alone cannot
 * say how far something got before it ended. None of it is persisted — these are counts
 * over the document, derived on render like every other view value.
 */

const LIVE_ORDER = new Map<StateId, number>(LIVE_STATE_IDS.map((id, index) => [id, index]));
const STATE_ORDER = new Map<StateId, number>(STATE_IDS.map((id, index) => [id, index]));

/** Ordered oldest first, so the first entry is where the application started. */
function historyInOrder(application: Application) {
  return [...application.state_history].sort((left, right) => left.at.localeCompare(right.at));
}

/**
 * Whether anything was recorded after the state the application started in.
 *
 * This is the closest honest reading of "did they reply" the document supports, and it is
 * named for what it measures rather than for what it is used as: a second recorded state
 * is a second recorded state. It counts a rejection, because a rejection is a reply. It
 * does not count an application filed straight into a rejected state, which has one entry
 * and never had a first reply to measure.
 */
export function heardBack(application: Application): boolean {
  return application.state_history.length > 1;
}

/**
 * Days from the starting state to whatever was recorded next, or null if nothing was.
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
 * Whether the application ever reached a live stage later than the one it started in.
 *
 * Stage order comes from `LIVE_STATE_IDS`, so a move that skips stages still counts and a
 * move backwards does not. Reaching a rejected state is not progress, which is what
 * separates this from `heardBack`.
 */
export function advanced(application: Application): boolean {
  const history = historyInOrder(application);
  const start = LIVE_ORDER.get(history[0]?.state as StateId);
  if (start === undefined) return false;

  return history.slice(1).some((entry) => {
    const rank = LIVE_ORDER.get(entry.state);
    return rank !== undefined && rank > start;
  });
}

export interface StageMove {
  from: StateId;
  to: StateId;
  /** How many times this move was recorded, across every application. */
  count: number;
}

/**
 * Every move recorded in `state_history`, grouped by where it left and where it landed.
 *
 * This is what `movedOn` cannot say: any state may move to any other, so "moved on" from
 * a stage covers going further, going back, and being turned down, and only the history
 * itself says which. Each consecutive pair of entries is one move, so an application that
 * went back and forth between two stages counts each crossing. Ordered by configured state
 * order on both ends, which is the order the stages are read in everywhere else.
 */
export function stageMoves(applications: Application[]): StageMove[] {
  const moves = new Map<string, StageMove>();

  for (const application of applications) {
    const history = historyInOrder(application);
    for (let index = 1; index < history.length; index += 1) {
      const from = history[index - 1]!.state;
      const to = history[index]!.state;
      if (from === to) continue;
      const key = `${from}>${to}`;
      const move = moves.get(key) ?? { from, to, count: 0 };
      move.count += 1;
      moves.set(key, move);
    }
  }

  return [...moves.values()].sort(
    (left, right) =>
      STATE_ORDER.get(left.from)! - STATE_ORDER.get(right.from)! ||
      STATE_ORDER.get(left.to)! - STATE_ORDER.get(right.to)!,
  );
}

export type StageMoveKind = "further" | "rejected" | "other";

/**
 * What a move amounted to: a later live stage than the one it left, a rejection, or
 * anything else — going back, closing without a rejection, leaving a rejected state. The
 * same reading of stage order `advanced` uses, so the two cannot disagree about progress.
 */
export function stageMoveKind(move: Pick<StageMove, "from" | "to">): StageMoveKind {
  if (isRejectedState(move.to)) return "rejected";
  const from = LIVE_ORDER.get(move.from);
  const to = LIVE_ORDER.get(move.to);
  if (from !== undefined && to !== undefined && to > from) return "further";
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

/** Past every live stage there is: a later live stage, or an accepted offer. */
function isBeyond(state: StateId, rank: number): boolean {
  if (state === "accepted") return true;
  const later = LIVE_ORDER.get(state);
  return later !== undefined && later > rank;
}

export interface StagePassRow {
  state: StateId;
  /** Reached the stage and are no longer sitting in it: the ones it has an answer for. */
  decided: number;
  /** Of those, the ones that went on to a later live stage, or to an accepted offer. */
  passed: number;
  /** Sitting in it now, so it is too soon to say whether they will pass it. */
  pending: number;
}

/**
 * For each live stage: of the applications that reached it and have since been decided,
 * how many got past it.
 *
 * Two choices make this a pass rate rather than a count. Applications still in the stage
 * are left out of it, because counting them as losses would make every stage look worse
 * than it is the moment anything new arrives. And passing means reaching any later live
 * stage, not the next one in the list: not every process has a take-home, so an
 * application that skipped one still passed the stage before it. `accepted` passes every
 * stage, including Offer, which no live stage comes after.
 */
export function stagePassRates(applications: Application[]): StagePassRow[] {
  const rows = new Map<StateId, StagePassRow>();

  for (const application of applications) {
    const history = historyInOrder(application);
    const seen = new Set<StateId>();

    history.forEach((entry, index) => {
      const rank = LIVE_ORDER.get(entry.state);
      if (rank === undefined || seen.has(entry.state)) return;
      seen.add(entry.state);

      const row = rows.get(entry.state) ?? { state: entry.state, decided: 0, passed: 0, pending: 0 };
      const passed = history.slice(index + 1).some((later) => isBeyond(later.state, rank));
      if (passed) {
        row.decided += 1;
        row.passed += 1;
      } else if (application.state === entry.state) {
        row.pending += 1;
      } else {
        row.decided += 1;
      }
      rows.set(entry.state, row);
    });
  }

  return [...rows.values()].sort(
    (left, right) => LIVE_ORDER.get(left.state)! - LIVE_ORDER.get(right.state)!,
  );
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
    else if (classifyLifecycle(application.state) === "live") waiting += 1;
  }
  return { replied, waiting };
}

export interface WeekActivity {
  /** Local midnight on the Monday the week starts. */
  start: Date;
  /** Applications whose first recorded state falls in the week. */
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
  /** Days from the first recorded state to the rejection, per rejected application. */
  toRejection: number[];
  /** Days from the first recorded state to first reaching Offer, per application that did. */
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
    if (isRejectedState(application.state)) {
      const days = span(history[0]?.at, history.at(-1)?.at);
      if (days !== null) toRejection.push(days);
    }
    const offer = history.find((entry) => entry.state === "offer");
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
