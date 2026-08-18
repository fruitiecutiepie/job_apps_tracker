import { NotebookPen } from "lucide-react";
import type { Application } from "../domain";

interface StageNotesButtonProps {
  application: Application;
  onOpenStageNotes: (id: string) => void;
  variant: "card" | "table";
}

/** Opens the stage prep notes for an application, showing how many stages already have notes. */
export function StageNotesButton({ application, onOpenStageNotes, variant }: StageNotesButtonProps) {
  const count = application.stage_notes.length;
  const label =
    count === 0
      ? `Add prep notes for ${application.company}`
      : `Prep notes for ${application.company}, ${count} ${count === 1 ? "stage" : "stages"}`;

  return (
    <button
      aria-label={label}
      className={`button button--quiet stage-notes-button stage-notes-button--${variant}`}
      onClick={() => onOpenStageNotes(application.id)}
      type="button"
    >
      <NotebookPen aria-hidden="true" size={14} />
      <span>Prep notes{count > 0 ? ` · ${count}` : ""}</span>
    </button>
  );
}
