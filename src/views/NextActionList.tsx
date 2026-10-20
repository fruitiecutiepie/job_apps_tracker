import type { Application } from "../domain";
import { CompleteActionButton } from "./CompleteActionButton";
import { DeleteActionButton } from "./DeleteActionButton";
import { formatShortDate } from "./viewUtils";

interface NextActionListProps {
  application: Application;
  onCompleteAction: (id: string, actionId: string) => void;
  onDeleteAction: (id: string, actionId: string) => void;
  variant: "card" | "table";
}

/**
 * Every task still to do on an application, in stored order — dated soonest first, then
 * undated — each with its own Done and Delete. The Kanban card and the table's Next action
 * cell both render this, so the two cannot list the same tasks differently.
 *
 * A list rather than a run of lines so a screen reader announces how many there are, and
 * each task's controls follow the task they act on rather than sitting on a shared row.
 */
export function NextActionList({
  application,
  onCompleteAction,
  onDeleteAction,
  variant,
}: NextActionListProps) {
  return (
    <ul className={`next-action-list next-action-list--${variant}`}>
      {application.next_actions.map((action) => (
        <li className="next-action-list__item" key={action.id}>
          <span className="next-action-list__text">
            {action.action}
            {action.at ? (
              <time className="next-action-list__date" dateTime={action.at}>
                {formatShortDate(action.at)}
              </time>
            ) : null}
          </span>
          <CompleteActionButton
            action={action}
            application={application}
            onCompleteAction={onCompleteAction}
            variant={variant}
          />
          <DeleteActionButton
            action={action}
            application={application}
            onDeleteAction={onDeleteAction}
            variant={variant}
          />
        </li>
      ))}
    </ul>
  );
}
