import { CircleSlash } from "lucide-react";
import { classifyLifecycle, rejectedStateFor, stateLabel } from "../domain";
import type { Application, StateId } from "../domain";

interface RejectButtonProps {
  application: Application;
  onMove: (id: string, state: StateId) => void;
}

/**
 * One click to the rejected counterpart of the state an application is in.
 *
 * The state select beside it can already reach that state, so this is a shortcut rather
 * than a capability — but it is a shortcut for the single most common move there is, and
 * the select makes you pick it out of nineteen options every time.
 *
 * It renders nothing on a finished row, like `CompleteActionButton` on a row with no task:
 * a rejected application has nowhere left to be rejected to, and `accepted` and
 * `no_openings` have no counterpart at all. That is `rejectedStateFor` plus the lifecycle
 * check, not a list of its own, so it cannot fall out of step with `STATE_CONFIG`.
 *
 * The accessible name says which state it moves to, so a screen reader hears the outcome
 * rather than a column of identical "Reject" buttons.
 */
export function RejectButton({ application, onMove }: RejectButtonProps) {
  if (classifyLifecycle(application.state) !== "live") return null;

  const rejected = rejectedStateFor(application.state);
  if (!rejected) return null;

  return (
    <button
      aria-label={`Move ${application.company} to ${stateLabel(rejected)}`}
      className="button button--quiet reject-button"
      onClick={() => onMove(application.id, rejected)}
      type="button"
    >
      <CircleSlash aria-hidden="true" size={14} />
      <span>Reject</span>
    </button>
  );
}
