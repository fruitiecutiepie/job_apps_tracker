import { CircleCheck } from "lucide-react";
import type { Application } from "../domain";

interface CompleteActionButtonProps {
  application: Application;
  onCompleteAction: (id: string) => void;
  variant: "card" | "table";
}

/**
 * Resolves an application's next action: the plan is cleared and what was done is logged in
 * the notes as a dated line. Renders nothing when there is no action, because there is
 * nothing to resolve — a disabled control on every untasked row would be pure noise.
 *
 * The accessible name names the action, so a screen reader hears which task is being closed
 * rather than a row of identical "Done" buttons.
 */
export function CompleteActionButton({
  application,
  onCompleteAction,
  variant,
}: CompleteActionButtonProps) {
  const action = application.next_action?.trim();
  if (!action) return null;

  return (
    <button
      aria-label={`Mark done for ${application.company}: ${action}`}
      className={`button button--quiet complete-action-button complete-action-button--${variant}`}
      onClick={() => onCompleteAction(application.id)}
      type="button"
    >
      <CircleCheck aria-hidden="true" size={14} />
      <span>Done</span>
    </button>
  );
}
