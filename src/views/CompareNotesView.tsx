import { useMemo, useState } from "react";
import { STATE_CONFIG, stateLabel, stateRank } from "../domain";
import type { Application, StateId } from "../domain";
import { CompareNoteCard } from "./CompareNoteCard";

interface CompareNotesViewProps {
  applications: Application[];
  onOpenStageNotes: (id: string) => void;
  onSaveStageNote: (id: string, state: StateId, body: string) => Promise<void>;
}

/**
 * Reads and edits prep notes across several applications at once. "All stages" groups by
 * whatever stages the selected applications already have notes for, good for skimming what
 * you have written; picking one stage instead lays out every selected application at that
 * stage, including ones with nothing yet, so a gap in your prep is something you see and can
 * fill in here rather than something the view quietly leaves out.
 */
export function CompareNotesView({ applications, onOpenStageNotes, onSaveStageNote }: CompareNotesViewProps) {
  const candidates = useMemo(
    () =>
      applications
        .filter((application) => application.stage_notes.length > 0)
        .sort((left, right) => left.company.localeCompare(right.company)),
    [applications],
  );

  const [selected, setSelected] = useState<Set<string> | null>(null);
  const selectedIds = selected ?? new Set(candidates.map((application) => application.id));

  const [stage, setStage] = useState<StateId | "all">("all");

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current ?? candidates.map((application) => application.id));
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const chosen = candidates.filter((application) => selectedIds.has(application.id));

  const groups = useMemo(() => {
    if (stage !== "all") return [{ state: stage, applications: chosen }];

    const states = new Set<StateId>();
    for (const application of chosen) {
      for (const note of application.stage_notes) states.add(note.state);
    }
    return [...states]
      .sort((left, right) => stateRank(left) - stateRank(right))
      .map((state) => ({
        state,
        applications: chosen.filter((application) =>
          application.stage_notes.some((note) => note.state === state),
        ),
      }));
  }, [chosen, stage]);

  const save = (id: string, state: StateId) => (body: string) => onSaveStageNote(id, state, body);

  return (
    <section aria-labelledby="compare-notes-heading" className="compare-notes">
      <header className="view-heading">
        <h2 className="sr-only" id="compare-notes-heading">Compare prep notes</h2>
        <div className="compare-notes__toolbar">
          <label className="field compare-notes__stage-field">
            <span>Stage</span>
            <select
              onChange={(event) => setStage(event.target.value as StateId | "all")}
              value={stage}
            >
              <option value="all">All stages</option>
              {STATE_CONFIG.map(({ id, label }) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>

          {candidates.length > 0 ? (
            <div className="compare-notes__picker" role="group" aria-label="Applications to compare">
              <button
                className="button button--quiet"
                onClick={() => setSelected(new Set(candidates.map((application) => application.id)))}
                type="button"
              >
                Select all
              </button>
              <button className="button button--quiet" onClick={() => setSelected(new Set())} type="button">
                Select none
              </button>
              <div className="compare-notes__chips">
                {candidates.map((application) => (
                  <label className="compare-notes__chip" key={application.id}>
                    <input
                      checked={selectedIds.has(application.id)}
                      onChange={() => toggle(application.id)}
                      type="checkbox"
                    />
                    {application.company}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {candidates.length === 0 ? (
        <p className="empty-state">No applications have prep notes yet.</p>
      ) : chosen.length === 0 ? (
        <p className="empty-state">Select at least one application to compare.</p>
      ) : (
        <div className="compare-notes__board">
          {groups.map((group) => (
            <section
              aria-label={stateLabel(group.state)}
              className="compare-notes__group"
              key={group.state}
              role="region"
            >
              {stage === "all" ? <h3 className="compare-notes__group-heading">{stateLabel(group.state)}</h3> : null}
              <div className="compare-notes__row">
                {group.applications.map((application) => (
                  <CompareNoteCard
                    application={application}
                    key={application.id}
                    onOpenFull={() => onOpenStageNotes(application.id)}
                    onSave={save(application.id, group.state)}
                    state={group.state}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
