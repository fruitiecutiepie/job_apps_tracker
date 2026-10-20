import { Trash2 } from "lucide-react";
import type { Application, NextAction } from "../domain";

interface DeleteActionButtonProps {
  application: Application;
  action: NextAction;
  onDeleteAction: (id: string, actionId: string) => void;
  variant: "card" | "table";
}

/**
 * Drops one of an application's next actions without recording it as done — the task that
 * will not happen, rather than the one that did. Sits after `CompleteActionButton` on the same
 * task and follows its rules: icon-only with a hover title, and an accessible name stating the
 * task, so a screen reader hears which one goes rather than a column of identical buttons.
 */
export function DeleteActionButton({
  application,
  action,
  onDeleteAction,
  variant,
}: DeleteActionButtonProps) {
  return (
    <button
      aria-label={`Delete next action for ${application.company}: ${action.action}`}
      className={`button button--quiet delete-action-button delete-action-button--${variant}`}
      onClick={() => onDeleteAction(application.id, action.id)}
      title="Delete next action"
      type="button"
    >
      <Trash2 aria-hidden="true" size={14} />
    </button>
  );
}
