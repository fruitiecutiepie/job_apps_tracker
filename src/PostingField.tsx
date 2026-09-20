/**
 * Where the job posting is pasted in.
 *
 * Paste, and only paste: a listing is routinely JS-rendered or behind a login, so anything
 * that fetched it would come back with a shell of a page most of the time and look like the
 * posting had simply gone. Copying the text is the one way that works everywhere, so it is
 * the only way offered rather than a fallback behind a button that usually fails.
 *
 * Unlike the attachments beside it, nothing here is staged: the posting is text inside the
 * document, so it is written by the same save as the rest of the form.
 */

import { Trash2 } from 'lucide-react'

export interface PostingRow {
  body: string
  sourceUrl: string
  /** When the text in the document was captured, or null while it has never been saved. */
  capturedAt: string | null
}

interface PostingFieldProps {
  row: PostingRow
  onChange: (row: PostingRow) => void
  /** The application's own link, offered as the posting's source when there is nothing else. */
  applicationUrl: string
  formatDate: (value: string) => string
}

export function PostingField({ row, onChange, applicationUrl, formatDate }: PostingFieldProps) {
  const hasBody = row.body.trim().length > 0

  return (
    <div className="field field--wide posting-field" role="group" aria-label="Job posting">
      <p className="posting-field__heading">
        <span className="posting-field__name">Job posting</span>
        {row.capturedAt ? (
          <small className="posting-field__meta">
            Captured{' '}
            <time dateTime={row.capturedAt}>{formatDate(row.capturedAt)}</time>
          </small>
        ) : null}
      </p>
      <p className="posting-field__hint">
        Paste the posting here to keep what it said. Listings get taken down and quietly
        reworded, and the link above will not show you the version you applied to.
      </p>
      <label className="field">
        <span className="sr-only">Job posting text</span>
        <textarea
          onChange={(event) => onChange({ ...row, body: event.target.value })}
          placeholder="Paste the job posting…"
          rows={8}
          value={row.body}
        />
      </label>
      <div className="posting-field__footer">
        <label className="field posting-field__source">
          <span>Where you read it</span>
          <input
            inputMode="url"
            onChange={(event) => onChange({ ...row, sourceUrl: event.target.value })}
            placeholder={applicationUrl || 'https://…'}
            type="url"
            value={row.sourceUrl}
          />
        </label>
        {hasBody ? (
          <button
            className="button button--quiet"
            onClick={() => onChange({ body: '', sourceUrl: '', capturedAt: null })}
            type="button"
          >
            <Trash2 aria-hidden="true" size={14} />
            Clear posting
          </button>
        ) : null}
      </div>
    </div>
  )
}
