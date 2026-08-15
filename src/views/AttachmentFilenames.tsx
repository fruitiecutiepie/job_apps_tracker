import { Paperclip } from "lucide-react";
import type { Attachment } from "../domain";

interface AttachmentFilenamesProps {
  attachments: Attachment[];
  variant: "card" | "table";
}

export function formatAttachmentFilenames(attachments: Attachment[]): string {
  return attachments.map((attachment) => attachment.filename).join(" · ");
}

export function AttachmentFilenames({ attachments, variant }: AttachmentFilenamesProps) {
  if (attachments.length === 0) return null;

  const label = formatAttachmentFilenames(attachments);

  if (variant === "table") {
    return <span className="attachment-filenames attachment-filenames--table">{label}</span>;
  }

  return (
    <p className="application-card__attachments" aria-label="Attachments">
      <Paperclip aria-hidden="true" className="application-card__attachments-icon" size={14} />
      <span className="attachment-filenames attachment-filenames--card">{label}</span>
    </p>
  );
}
