import { STATE_CONFIG, classifyLifecycle, stageNoteFor } from "../domain";
import type { Application, StateId } from "../domain";

/** One application's place at a stage on the comparison board. */
export interface CompareEntry {
  application: Application;
  /** The application is at this stage now, so this is prep for something still ahead. */
  isHere: boolean;
  /** Something is written or captured for this stage. False only for a live gap. */
  hasNote: boolean;
}

export interface CompareStage {
  state: StateId;
  entries: CompareEntry[];
}

/**
 * The stages worth comparing, in pipeline order, and who belongs at each.
 *
 * An application belongs at a stage when it holds a note for it, whatever state it is in
 * now — a rejected application's Round 1 prep is still the thing to reread before the
 * next Round 1 — or when it is live and at that stage now with nothing written, which
 * is the gap worth seeing. A live application with no note for some *other* stage is not a
 * gap: every application lacks notes for most of the ten, and listing them all is how
 * the board used to fill with empty editors for stages nobody was heading into.
 *
 * Within a stage, the applications there now come first, since those are what is being
 * prepared; the notes written elsewhere follow as reference. Company breaks the tie.
 */
export function compareStages(applications: readonly Application[]): CompareStage[] {
  return STATE_CONFIG.flatMap(({ id: state }) => {
    const entries = applications
      .map((application) => ({
        application,
        isHere: application.state === state,
        hasNote: stageNoteFor(application, state) != null,
      }))
      .filter(
        (entry) =>
          entry.hasNote || (entry.isHere && classifyLifecycle(entry.application) === "live"),
      )
      .sort(
        (left, right) =>
          Number(right.isHere) - Number(left.isHere) ||
          left.application.company.localeCompare(right.application.company),
      );
    return entries.length > 0 ? [{ state, entries }] : [];
  });
}

/**
 * The stage the board opens on: the one with the most to compare, the later stage on a
 * tie, since a later stage is the one closer to an outcome. Null only when there is
 * nothing to compare anywhere.
 */
export function defaultCompareStage(stages: readonly CompareStage[]): StateId | null {
  let best: CompareStage | null = null;
  for (const stage of stages) {
    if (!best || stage.entries.length >= best.entries.length) best = stage;
  }
  return best?.state ?? null;
}
