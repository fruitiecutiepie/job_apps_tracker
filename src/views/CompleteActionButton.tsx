import { CircleCheck, Trash2 } from "lucide-react";
import type { Application } from "../domain";

interface CompleteActionButtonProps {
  application: Application;
  onCompleteAction: (id: string) => void;
  /**
   * Drops the action without logging it as done. Optional so a view rendered on its own
   * offers only Done; the app always passes it.
   */
  onDeleteAction?: (id: string) => void;
  variant: "card" | "table";
}

/**
 * Resolves an application's next action: the plan is cleared and what was done is logged in
 * the notes as a dated line. Renders nothing when there is no action, because there is
 * nothing to resolve — a disabled control on every untasked row would be pure noise.
 *
 * Beside it, Delete is for a task that is no longer going to happen: Done would log it as
 * carried out, and an abandoned task was not. It is an icon for the reason the Archive
 * shortcut is one — the row cannot spare a second word.
 *
 * The accessible name names the action, so a screen reader hears which task is being closed
 * rather than a row of identical "Done" buttons.
 */
export function CompleteActionButton({
  application,
  onCompleteAction,
  onDeleteAction,
  variant,
}: CompleteActionButtonProps) {
  const action = application.next_action?.trim();
  if (!action) return null;

  return (
    <span className={`complete-action-group complete-action-group--${variant}`}>
      <button
        aria-label={`Mark done for ${application.company}: ${action}`}
        className={`button button--quiet complete-action-button complete-action-button--${variant}`}
        onClick={() => onCompleteAction(application.id)}
        type="button"
      >
        <CircleCheck aria-hidden="true" size={14} />
        <span>Done</span>
      </button>
      {onDeleteAction ? (
        <button
          aria-label={`Delete next action for ${application.company}: ${action}`}
          className={`button button--quiet complete-action-button complete-action-button--${variant}`}
          onClick={() => onDeleteAction(application.id)}
          title="Delete without marking done"
          type="button"
        >
          <Trash2 aria-hidden="true" size={14} />
        </button>
      ) : null}
    </span>
  );
}
