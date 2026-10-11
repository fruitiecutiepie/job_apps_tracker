import { useMemo, useState } from "react";
import { stageLabel, stageRank } from "../domain";
import type { Application, StageId } from "../domain";
import { CompareNoteCard } from "./CompareNoteCard";
import { compareStages, defaultCompareStage } from "./compareStages";
import type { CompareEntry } from "./compareStages";

interface CompareNotesViewProps {
  applications: Application[];
  onOpenStageNotes: (id: string, stage: StageId) => void;
  onSaveStageNote: (id: string, stage: StageId, body: string, base: string) => Promise<string | void>;
}

/**
 * One stage at a time, laid out across every application it concerns: what you wrote for
 * Round 1 at each company side by side, and the live applications at Round 1 with
 * nothing written yet as gaps to fill in here. Which applications those are is the global
 * filters' business — the view has no picker of its own, since a second filter over the
 * same collection is two ways to narrow one thing.
 */
export function CompareNotesView({ applications, onOpenStageNotes, onSaveStageNote }: CompareNotesViewProps) {
  const stages = useMemo(() => compareStages(applications), [applications]);

  /*
   * What is on the board stays there for as long as its stage is showing, even if what put
   * it there goes: clearing a note written elsewhere removes the only reason it was listed,
   * and a card vanishing under the caret a second after the text is selected and deleted
   * reads as losing the note rather than rewriting it. The same holds for the stage, which
   * would otherwise drop out of the list when its only note is cleared and swap the board
   * for another. `shown` is that memory, adjusted during render rather than in an effect so
   * no render ever shows the board without it; picking another stage is what lets it go.
   */
  const [picked, setPicked] = useState<StageId | null>(null);
  const [shown, setShown] = useState<{ stage: StageId | null; ids: string[] }>({ stage: null, ids: [] });

  const retained = (stage: StageId | null) =>
    shown.stage !== null && shown.stage === stage && shown.ids.some((id) => applications.some((item) => item.id === id));
  const valid = (stage: StageId | null): stage is StageId =>
    stage !== null && (stages.some((item) => item.stage === stage) || retained(stage));
  const stage = [picked, shown.stage].find(valid) ?? defaultCompareStage(stages);

  const listed = stages.find((item) => item.stage === stage)?.entries ?? [];
  const listedIds = listed.map((entry) => entry.application.id);
  if (shown.stage !== stage || listedIds.some((id) => !shown.ids.includes(id))) {
    const kept = shown.stage === stage ? shown.ids : [];
    setShown({ stage: stage, ids: [...new Set([...kept, ...listedIds])] });
  }
  const entries: CompareEntry[] = [...listed];
  for (const id of shown.stage === stage ? shown.ids : []) {
    if (listedIds.includes(id)) continue;
    const application = applications.find((item) => item.id === id);
    if (application) entries.push({ application, isHere: application.stage === stage, hasNote: false });
  }

  // The stage on show keeps its place in the list, counted by what the board is holding.
  const options = stage && !stages.some((item) => item.stage === stage)
    ? [...stages, { stage: stage, entries }].sort((left, right) => stageRank(left.stage) - stageRank(right.stage))
    : stages;

  if (!stage) {
    return (
      <section aria-labelledby="compare-notes-heading" className="compare-notes">
        <h2 className="sr-only" id="compare-notes-heading">Compare prep notes</h2>
        <p className="empty-state">Nothing to compare yet. Prep notes, and applications still in progress, appear here by stage.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="compare-notes-heading" className="compare-notes">
      <h2 className="sr-only" id="compare-notes-heading">Compare prep notes</h2>

      <fieldset className="compare-notes__stages">
        <legend className="sr-only">Stage</legend>
        {options.map((item) => {
          const count = item.stage === stage ? entries.length : item.entries.length;
          return (
            <label className="compare-notes__stage" key={item.stage}>
              <input
                checked={item.stage === stage}
                name="compare-stage"
                onChange={() => setPicked(item.stage)}
                type="radio"
                value={item.stage}
              />
              <span>{stageLabel(item.stage)}</span>
              <span aria-hidden="true" className="count-badge">{count}</span>
              <span className="sr-only">, {count} {count === 1 ? "application" : "applications"}</span>
            </label>
          );
        })}
      </fieldset>

      <section aria-labelledby="compare-notes-stage" className="compare-notes__stage-board">
        {/* The pill above already names the stage and counts it, and every gap says so on its
            own card, so the heading is for a screen reader's outline rather than the eye. */}
        <h3 className="sr-only" id="compare-notes-stage">{stageLabel(stage)}</h3>
        <div className="compare-notes__grid">
          {entries.map(({ application, isHere }) => (
            <CompareNoteCard
              application={application}
              isHere={isHere}
              key={`${application.id}:${stage}`}
              onOpenFull={() => onOpenStageNotes(application.id, stage)}
              onSave={(body, base) => onSaveStageNote(application.id, stage, body, base)}
              stage={stage}
            />
          ))}
        </div>
      </section>
    </section>
  );
}
