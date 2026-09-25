import { Mail } from "lucide-react";
import type { Application, StateId } from "../domain";

interface MessagesButtonProps {
  application: Application;
  onOpenMessages: (id: string, messagesFor: StateId) => void;
}

/**
 * Opens an application's messages from its card, showing how many it holds.
 *
 * Goes to the **form** rather than to the prep notes panel, which the button beside it already
 * reaches. A card is one application and the panel reads one stage at a time, so the form is
 * the surface that holds the whole log — and the only one that can write it. It lands on the
 * card's own stage, which is the conversation most likely to be live.
 */
export function MessagesButton({ application, onOpenMessages }: MessagesButtonProps) {
  const count = application.correspondence.length;
  const label =
    count === 0
      ? `Log a message for ${application.company}`
      : `Messages for ${application.company}, ${count} ${count === 1 ? "message" : "messages"}`;

  return (
    <button
      aria-label={label}
      className="button button--quiet messages-button messages-button--card"
      onClick={() => onOpenMessages(application.id, application.state)}
      type="button"
    >
      <Mail aria-hidden="true" size={14} />
      <span>Messages{count > 0 ? ` · ${count}` : ""}</span>
    </button>
  );
}
