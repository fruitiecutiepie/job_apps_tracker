import { Archive, ArchiveRestore, ArrowLeft, ArrowRight, ChevronDown, RotateCcw } from "lucide-react";
import {
  ENDING_OUTCOMES,
  nextStage,
  outcomeLabel,
  previousStage,
  stageLabel,
  statusLabel,
} from "../domain";
import type { Application, OutcomeId } from "../domain";
import { DisclosureMenu } from "../DisclosureMenu";
import type { MoveHandler, ArchiveHandler } from "./types";

/**
 * How each way of ending reads in the End menu. The outcome labels are nouns for a filter
 * ("Withdrawn"); these say who did it, because that is the question the menu is asking.
 */
const ENDING_WORDS: Record<OutcomeId, { label: string; hint: string }> = {
  active: { label: "Active", hint: "" },
  rejected: { label: "Rejected", hint: "They turned you down" },
  withdrawn: { label: "I withdrew", hint: "You pulled out" },
  closed: { label: "Employer closed", hint: "Filled, pulled, frozen or went silent" },
};

interface MoveControlsProps {
  application: Application;
  onMove: MoveHandler;
  onArchive: ArchiveHandler;
  variant: "card" | "table";
}

/**
 * The moves an application usually wants next, one press each, so the stage select is for
 * the rarer jump rather than for every step.
 *
 * What is offered follows where the application stands. One still running goes back a
 * stage, on a stage, ends — the three ways of ending behind one control, since you end an
 * application once and step it along many times — or goes into the archive as it is. At an
 * offer the step on is taking it. One that has ended reopens where it stopped, or goes into
 * the archive; one in the archive only comes back out.
 *
 * Back and on are arrows alone. The stage they go to is in their name and their tooltip:
 * written on the face it cost the row its width and read, beside the back arrow, like a
 * stepper around the current stage.
 *
 * These are shortcuts, never the only way: the stage select beside them reaches every
 * stage, and the editor reaches every stage and outcome. Every name says where the press
 * goes, so a screen reader hears the outcome rather than a column of identical "Next"s.
 */
export function MoveControls({ application, onMove, onArchive, variant }: MoveControlsProps) {
  const { company, id, stage, outcome } = application;
  const className = `move-controls move-controls--${variant}`;

  if (application.archived_at !== null) {
    return (
      <div className={className}>
        <button
          aria-label={`Unarchive ${company}`}
          className="button button--quiet move-controls__button"
          onClick={() => onArchive(id, false)}
          type="button"
        >
          <ArchiveRestore aria-hidden="true" size={14} />
          <span>Unarchive</span>
        </button>
      </div>
    );
  }

  if (outcome !== "active") {
    return (
      <div className={className}>
        <button
          aria-label={`Reopen ${company} at ${stageLabel(stage)}`}
          className="button button--quiet move-controls__button"
          onClick={() => onMove(id, { outcome: "active" })}
          title={`Reopen at ${stageLabel(stage)}`}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={14} />
          <span className="move-controls__label">Reopen</span>
        </button>
        <button
          aria-label={`Archive ${company}`}
          className="button button--quiet move-controls__button"
          onClick={() => onArchive(id, true)}
          title="Archive"
          type="button"
        >
          <Archive aria-hidden="true" size={14} />
          <span className="move-controls__label">Archive</span>
        </button>
      </div>
    );
  }

  const previous = previousStage(stage);
  const next = nextStage(stage);

  return (
    <div className={className}>
      {previous ? (
        <button
          aria-label={`Move ${company} back to ${stageLabel(previous)}`}
          className="button button--quiet move-controls__button move-controls__back"
          onClick={() => onMove(id, { stage: previous })}
          title={`Back to ${stageLabel(previous)}`}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={14} />
        </button>
      ) : null}
      {next ? (
        <button
          aria-label={`Move ${company} to ${stageLabel(next)}`}
          className="button button--quiet move-controls__button move-controls__next"
          onClick={() => onMove(id, { stage: next })}
          title={`Next: ${stageLabel(next)}`}
          type="button"
        >
          <ArrowRight aria-hidden="true" size={14} />
        </button>
      ) : null}
      <DisclosureMenu
        ariaLabel={`End ${company}`}
        className="move-controls__end"
        label={
          <>
            <span>End</span>
            <ChevronDown aria-hidden="true" size={14} />
          </>
        }
        panelClassName="actions-menu__panel move-controls__panel"
        triggerClassName="button button--quiet move-controls__button"
      >
        {ENDING_OUTCOMES.map((ending) => (
          <button
            aria-label={`Move ${company} to ${statusLabel({ stage, outcome: ending })}`}
            className="actions-menu__item move-controls__item"
            key={ending}
            onClick={() => onMove(id, { outcome: ending })}
            type="button"
          >
            <span className="move-controls__item-label">{ENDING_WORDS[ending].label}</span>
            <span className="move-controls__item-hint">{ENDING_WORDS[ending].hint}</span>
          </button>
        ))}
      </DisclosureMenu>
      {/*
        * Archiving is not only for what has ended: a search abandoned, or a role put on
        * hold, can go away still running. Icon-only here because the row is already full;
        * the name says what it does.
        */}
      <button
        aria-label={`Archive ${company}`}
        className="button button--quiet move-controls__button move-controls__archive"
        onClick={() => onArchive(id, true)}
        title="Archive"
        type="button"
      >
        <Archive aria-hidden="true" size={14} />
      </button>
    </div>
  );
}

/**
 * The outcome in words, beside a stage select that can only say the stage. Nothing for an
 * application still running: the select already says everything there is.
 */
export function OutcomeBadge({ application }: { application: Application }) {
  if (application.outcome === "active" && application.archived_at === null) return null;
  return (
    <span className="outcome-badges">
      {application.outcome !== "active" ? (
        <span className={`outcome-badge outcome-badge--${application.outcome}`}>
          {outcomeLabel(application.outcome)}
        </span>
      ) : null}
      {application.archived_at !== null ? (
        <ArchivedBadge />
      ) : null}
    </span>
  );
}

/** Archived, in words and in the dashed outline the archived card and row share. */
export function ArchivedBadge() {
  return (
    <span className="outcome-badge outcome-badge--archived">
      <Archive aria-hidden="true" size={11} />
      Archived
    </span>
  );
}
