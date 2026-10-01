import { FileText } from "lucide-react";
import type { Application } from "../domain";

interface PostingButtonProps {
  application: Application;
  onOpenPosting: (id: string) => void;
  variant: "card" | "table";
}

/**
 * Opens the job posting an application was answering, straight from the board.
 *
 * Renders nothing when that application captured none. A control that opened an empty pane
 * would be offering something that is not there, and a row of them greyed out across a
 * board would say only that most applications predate the posting field.
 */
export function PostingButton({ application, onOpenPosting, variant }: PostingButtonProps) {
  if (!application.posting) return null;

  return (
    <button
      aria-label={`Job posting for ${application.company}`}
      className={`button button--quiet posting-button posting-button--${variant}`}
      onClick={() => onOpenPosting(application.id)}
      type="button"
    >
      <FileText aria-hidden="true" size={14} />
      <span>Posting</span>
    </button>
  );
}
