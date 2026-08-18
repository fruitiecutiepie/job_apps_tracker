import type { StateEvent } from "../domain";
import { formatShortDate } from "./viewUtils";

interface InviteSummariesProps {
  invites: StateEvent[];
}

/** Text a column filter can match against every invite on an application. */
export function inviteFilterText(invites: StateEvent[]): string {
  return invites
    .map((invite) =>
      [
        invite.summary,
        invite.location,
        formatShortDate(invite.starts_at),
        invite.cancelled ? "cancelled" : null,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");
}

/**
 * Every invite on an application, soonest first, for one table cell. A cancelled
 * invite says so in words rather than relying on the strike-through alone.
 */
export function InviteSummaries({ invites }: InviteSummariesProps) {
  if (invites.length === 0) return null;

  const ordered = [...invites].sort(
    (left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at),
  );

  return (
    <ul className="invite-summaries">
      {ordered.map((invite) => (
        <li
          className={`invite-summary${invite.cancelled ? " invite-summary--cancelled" : ""}`}
          key={invite.id}
        >
          <span className="invite-summary__text">{invite.summary}</span>
          <time className="table-view__date" dateTime={invite.starts_at}>
            {formatShortDate(invite.starts_at)}
          </time>
          {invite.cancelled ? <span className="invite-summary__badge">Cancelled</span> : null}
        </li>
      ))}
    </ul>
  );
}
