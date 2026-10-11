import { FINAL_STAGE, stageRank } from "../domain";
import type { OutcomeId, Status } from "../domain";

/**
 * What a move on the board deserves saying. Derived from where an application stood and
 * where it is going, never stored: it is a reaction to a press, not a fact about the record.
 *
 * - `progress`: on to a later stage, still running.
 * - `accepted`: on to the last stage — taking the job.
 * - `ended`: an outcome that ends it, however it got there.
 *
 * Anything else — a step back, a reopen, a correction within a stage — says nothing. A step
 * back is most often a card put one stage too far, and cheering a correction would be noise.
 */
export type MoveFeedback =
  | { kind: "progress"; message: string }
  | { kind: "accepted"; message: string }
  | { kind: "ended"; outcome: Exclude<OutcomeId, "active">; message: string };

// True of any step forward. "One stage closer" is not: a card can jump several.
const PROGRESS_CHEERS = ["Keep it up!", "Nice work!", "Good momentum!"];

/**
 * What a message may draw on beyond the move. Not the company or the stage: the reader
 * just moved the card there, so saying where it went tells them nothing.
 */
export interface MoveContext {
  /**
   * Other applications on the board still running. The board is the filtered collection,
   * so the message says "on the board" rather than claiming a total it cannot see.
   */
  othersRunning: number;
}

/**
 * `turn` picks among the cheers, so the same one does not repeat on every move. It is
 * supplied rather than random so a test can say which one it gets.
 *
 * An ending gets no cheer, because nothing about it went well. It gets a line for that
 * way of ending, and how many applications are still going.
 */
export function moveFeedback(
  from: Status,
  change: Partial<Status>,
  { othersRunning }: MoveContext,
  turn = 0,
): MoveFeedback | null {
  const to: Status = { stage: change.stage ?? from.stage, outcome: change.outcome ?? from.outcome };

  if (to.outcome !== "active") {
    if (to.outcome === from.outcome) return null;
    return {
      kind: "ended",
      outcome: to.outcome,
      message: `${ENDED[to.outcome]} ${stillRunning(othersRunning)}`,
    };
  }

  if (stageRank(to.stage) <= stageRank(from.stage)) return null;
  if (to.stage === FINAL_STAGE) {
    return {
      kind: "accepted",
      message: "Congratulations, you earned this one!",
    };
  }
  return {
    kind: "progress",
    message: pick(PROGRESS_CHEERS, turn),
  };
}

// A reaction to what each outcome means in OUTCOME_CONFIG, not a claim about what happens
// next: rejected is their decision, withdrawn is yours, and closed is theirs without a
// rejection, silence included.
const ENDED: Record<Exclude<OutcomeId, "active">, string> = {
  rejected: "Sorry, that one stings.",
  withdrawn: "Good on you for choosing where your time goes.",
  closed: "That one's on them, not you.",
};

// "On your board" because the board is the filtered collection, not every application.
function stillRunning(count: number): string {
  if (count === 0) return "Take a breather, then add the next one.";
  if (count === 1) return "1 other on your board is still going.";
  return `${count} others on your board are still going.`;
}

function pick(options: readonly string[], turn: number): string {
  return options[((turn % options.length) + options.length) % options.length];
}
