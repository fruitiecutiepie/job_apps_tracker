import { LIVE_STATE_IDS, classifyLifecycle } from "../domain";
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

/** The furthest live stage an application ever reached, or null if it never held one. */
export function furthestLiveState(application: Application): StateId | null {
  let furthest: StateId | null = null;
  let best = -1;

  for (const entry of application.state_history) {
    const rank = LIVE_ORDER.get(entry.state);
    if (rank !== undefined && rank > best) {
      best = rank;
      furthest = entry.state;
    }
  }

  return furthest;
}

export interface StageOutcomeRow {
  state: StateId;
  /** Applications whose history holds this state, whether or not they are still in it. */
  reached: number;
  /** Applications sitting in it now. */
  here: number;
  /** Finished applications that got no further than this. */
  ended: number;
}

/**
 * One row per live stage that something has actually reached.
 *
 * Deliberately not called a funnel, and deliberately not asserted to fall away down the
 * list: any state may move to any other, so an application can skip a stage entirely and
 * a later stage can hold more than an earlier one. Stages nothing has reached are left
 * out rather than printed as zeros — the Kanban board already shows the whole ladder.
 */
export function stageOutcomes(applications: Application[]): StageOutcomeRow[] {
  const rows = new Map<StateId, StageOutcomeRow>();
  const rowFor = (state: StateId) => {
    const existing = rows.get(state);
    if (existing) return existing;
    const created: StageOutcomeRow = { state, reached: 0, here: 0, ended: 0 };
    rows.set(state, created);
    return created;
  };

  for (const application of applications) {
    for (const state of new Set(application.state_history.map((entry) => entry.state))) {
      if (LIVE_ORDER.has(state)) rowFor(state).reached += 1;
    }

    if (classifyLifecycle(application.state) === "live") {
      rowFor(application.state).here += 1;
      continue;
    }

    const furthest = furthestLiveState(application);
    if (furthest) rowFor(furthest).ended += 1;
  }

  return [...rows.values()].sort(
    (left, right) => LIVE_ORDER.get(left.state)! - LIVE_ORDER.get(right.state)!,
  );
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

export interface OutcomeSummary {
  total: number;
  live: number;
  heardBack: number;
  advanced: number;
  /** Median over the applications that have a first reply to measure, or null if none do. */
  medianDaysToFirstReply: number | null;
  stages: StageOutcomeRow[];
  sources: SourceOutcomeRow[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  // The lower of the two middles on an even count, so the figure is always one an
  // application actually took rather than a half-day nothing waited.
  return sorted.length % 2 === 0 ? sorted[middle - 1]! : sorted[middle]!;
}

export function outcomeSummary(applications: Application[]): OutcomeSummary {
  const replies = applications
    .map((application) => daysToFirstReply(application))
    .filter((days): days is number => days !== null);

  return {
    total: applications.length,
    live: applications.filter((item) => classifyLifecycle(item.state) === "live").length,
    heardBack: applications.filter(heardBack).length,
    advanced: applications.filter(advanced).length,
    medianDaysToFirstReply: median(replies),
    stages: stageOutcomes(applications),
    sources: sourceOutcomes(applications),
  };
}
