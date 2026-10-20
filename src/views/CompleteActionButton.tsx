import { CircleCheck } from "lucide-react";
import type { Application, NextAction } from "../domain";

interface CompleteActionButtonProps {
  application: Application;
  action: NextAction;
  onCompleteAction: (id: string, actionId: string) => void;
  variant: "card" | "table";
}

/**
 * Resolves one of an application's next actions: it leaves the plan and joins the record of
 * completed actions. One per task, beside the task it closes, so an application carrying
 * several never has to guess which one Done meant.
 *
 * Icon-only: the check says what it does, the hover title says it in words, and the
 * accessible name names the task, so a screen reader hears which one is being closed rather
 * than a row of identical buttons.
 */
export function CompleteActionButton({
  application,
  action,
  onCompleteAction,
  variant,
}: CompleteActionButtonProps) {
  return (
    <button
      aria-label={`Mark done for ${application.company}: ${action.action}`}
      className={`button button--quiet complete-action-button complete-action-button--${variant}`}
      onClick={() => onCompleteAction(application.id, action.id)}
      title="Mark next action done"
      type="button"
    >
      <CircleCheck aria-hidden="true" size={14} />
    </button>
  );
}
