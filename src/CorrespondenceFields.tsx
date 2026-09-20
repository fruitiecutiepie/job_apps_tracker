import { useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import { CHANNEL_SUGGESTIONS, CORRESPONDENCE_CONFIG, STATE_CONFIG, createUuidV7 } from './domain'
import type { StateId } from './domain'
import {
  correspondenceRowSummary,
  newCorrespondenceRow,
  type CorrespondenceRow,
} from './correspondence'

const CHANNEL_LIST_ID = 'correspondence-channels'

interface CorrespondenceFieldsProps {
  rows: CorrespondenceRow[]
  defaultState: StateId
  onChange: (rows: CorrespondenceRow[]) => void
}

export function CorrespondenceFields({
  rows,
  defaultState,
  onChange,
}: CorrespondenceFieldsProps) {
  /*
   * Which rows are showing their fields. A message is a record with six controls and an email
   * in it — five of them come to four screens of a dialog whose job is the application, not
   * the thread — so a row reads as one line until it is the one being worked on. Held here
   * rather than lifted: it is which row you are looking at, and it means nothing once the
   * dialog closes.
   */
  const [open, setOpen] = useState<string[]>([])
  const toggle = (id: string) =>
    setOpen((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    )

  // Keyed by id rather than by position: the rows read newest first while the domain stores
  // them oldest first, so a position here does not mean a position there.
  const update = (id: string, changes: Partial<CorrespondenceRow>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...changes } : row)))
  }

  return (
    <div className="field field--wide correspondence-field">
      <span>Correspondence</span>

      {rows.length > 0 && (
        <div className="correspondence-list">
          {rows.map((row, index) => (
            <fieldset className="correspondence-item" key={row.id}>
              <legend className="sr-only">Message {index + 1}</legend>
              {/*
                The row's own name, and what opens it. Its text is its accessible name rather
                than a "Show message 3": the summary is what tells two messages apart, and a
                number tells you only where in the list you are.
              */}
              <button
                aria-expanded={open.includes(row.id)}
                className="correspondence-item__summary"
                onClick={() => toggle(row.id)}
                type="button"
              >
                <ChevronRight aria-hidden="true" size={14} />
                <span>{correspondenceRowSummary(row)}</span>
              </button>
              {open.includes(row.id) ? (
                <>
              <div className="correspondence-item__head">
                <label className="field">
                  <span>Stage</span>
                  <select
                    onChange={(event) => update(row.id, { state: event.target.value as StateId })}
                    value={row.state}
                  >
                    {STATE_CONFIG.map((state) => (
                      <option key={state.id} value={state.id}>{state.label}</option>
                    ))}
                  </select>
                </label>
                {/*
                  Two radios rather than a select: a menu costs two interactions to choose
                  between two things, and both of them are worth seeing without opening
                  anything. Radios rather than buttons carrying `aria-pressed`, because this
                  is a choice between options and the platform already has a control that
                  says so — and gets the arrow keys right for free. Named per row, or two
                  messages on screen would share one group.
                */}
                <fieldset className="field correspondence-direction">
                  <legend>Direction</legend>
                  <div className="correspondence-direction__options">
                    {CORRESPONDENCE_CONFIG.map((direction) => (
                      <label className="correspondence-direction__option" key={direction.id}>
                        <input
                          checked={row.direction === direction.id}
                          name={`correspondence-direction-${row.id}`}
                          onChange={() => update(row.id, { direction: direction.id })}
                          type="radio"
                          value={direction.id}
                        />
                        <span>{direction.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="correspondence-item__grid">
                <label className="field">
                  <span>Who</span>
                  <input
                    onChange={(event) => update(row.id, { who: event.target.value })}
                    placeholder="e.g. Dana Okafor"
                    value={row.who}
                  />
                </label>
                <label className="field">
                  <span>Channel</span>
                  <input
                    list={CHANNEL_LIST_ID}
                    onChange={(event) => update(row.id, { channel: event.target.value })}
                    placeholder="e.g. Email"
                    value={row.channel}
                  />
                </label>
                <label className="field">
                  {/* Not "Sent", which is one of the two directions a line above. */}
                  <span>Date sent</span>
                  <input
                    onChange={(event) => update(row.id, { at: event.target.value })}
                    type="datetime-local"
                    value={row.at}
                  />
                </label>
              </div>
              <label className="field">
                <span>Message</span>
                <textarea
                  onChange={(event) => update(row.id, { body: event.target.value })}
                  placeholder="Paste what was written"
                  rows={4}
                  value={row.body}
                />
              </label>
              <div className="correspondence-item__foot">
                <button
                  className="button button--quiet"
                  onClick={() => onChange(rows.filter((current) => current.id !== row.id))}
                  type="button"
                >
                  Remove message {index + 1}
                </button>
              </div>
                </>
              ) : null}
            </fieldset>
          ))}
        </div>
      )}

      <div className="correspondence-field__actions">
        <button
          className="button button--quiet"
          onClick={() => {
            const added = newCorrespondenceRow(rows, defaultState, createUuidV7())
            setOpen((current) => [...current, added.id])
            onChange([added, ...rows])
          }}
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
          Add message
        </button>
      </div>
      <datalist id={CHANNEL_LIST_ID}>
        {CHANNEL_SUGGESTIONS.map((channel) => (
          <option key={channel} value={channel} />
        ))}
      </datalist>
      <p className="correspondence-field__hint">
        What was exchanged with the employer, and what you sent back. <strong>Date sent</strong> is when
        the message was sent, not when you wrote it down here — so a reply you log days later still
        reads under the day it arrived.
      </p>
    </div>
  )
}
