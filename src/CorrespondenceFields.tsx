import { Plus } from 'lucide-react'
import { CHANNEL_SUGGESTIONS, CORRESPONDENCE_CONFIG, STATE_CONFIG, createUuidV7 } from './domain'
import type { CorrespondenceDirection, StateId } from './domain'
import type { CorrespondenceRow } from './correspondence'

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
                <label className="field">
                  <span>Direction</span>
                  <select
                    onChange={(event) =>
                      update(row.id, {
                        direction: event.target.value as CorrespondenceDirection,
                      })
                    }
                    value={row.direction}
                  >
                    {CORRESPONDENCE_CONFIG.map((direction) => (
                      <option key={direction.id} value={direction.id}>{direction.label}</option>
                    ))}
                  </select>
                </label>
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
                  <span>Sent</span>
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
            </fieldset>
          ))}
        </div>
      )}

      <div className="correspondence-field__actions">
        <button
          className="button button--quiet"
          onClick={() =>
            onChange([
              {
                id: createUuidV7(),
                state: defaultState,
                direction: 'received',
                channel: '',
                who: '',
                body: '',
                at: '',
              },
              ...rows,
            ])
          }
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
        What was exchanged with the employer, and what you sent back. <strong>Sent</strong> is when
        the message was sent, not when you wrote it down here — so a reply you log days later still
        reads under the day it arrived.
      </p>
    </div>
  )
}
