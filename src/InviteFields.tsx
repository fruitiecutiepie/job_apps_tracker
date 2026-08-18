import { useRef, useState } from 'react'
import { Plus, Upload } from 'lucide-react'
import { STATE_CONFIG, createUuidV7, readFileAsUint8Array } from './domain'
import type { StateId } from './domain'
import { parseIcsEvents } from './calendar'
import { importSummary, mergeIcsEvents, type InviteRow } from './invites'

interface InviteFieldsProps {
  rows: InviteRow[]
  defaultState: StateId
  onChange: (rows: InviteRow[]) => void
}

export function InviteFields({ rows, defaultState, onChange }: InviteFieldsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  // What the last import did, reported beside the buttons that did it.
  const [message, setMessage] = useState<string | null>(null)

  const update = (index: number, changes: Partial<InviteRow>) => {
    onChange(rows.map((row, position) => (position === index ? { ...row, ...changes } : row)))
  }

  const importIcs = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      const bytes = await readFileAsUint8Array(file)
      const events = parseIcsEvents(new TextDecoder().decode(bytes))
      const usable = events.filter((event) => event.starts_at !== null)
      if (usable.length === 0) {
        setMessage('That file held no invite with a readable start time.')
        return
      }
      const result = mergeIcsEvents(rows, usable, defaultState)
      onChange(result.rows)
      setMessage(importSummary(result))
    } catch {
      setMessage('That file could not be read as a calendar invite.')
    }
  }

  return (
    <div className="field field--wide invite-field">
      <span>Interview invites</span>

      {rows.length > 0 && (
        <div className="invite-list">
          {rows.map((row, index) => (
            <fieldset className="invite-item" key={row.id}>
              <legend className="sr-only">Invite {index + 1}</legend>
              <div className="invite-item__head">
                <label className="field">
                  <span>Stage</span>
                  <select
                    onChange={(event) => update(index, { state: event.target.value as StateId })}
                    value={row.state}
                  >
                    {STATE_CONFIG.map((state) => (
                      <option key={state.id} value={state.id}>{state.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>What</span>
                  <input
                    onChange={(event) => update(index, { summary: event.target.value })}
                    placeholder="e.g. Panel interview"
                    value={row.summary}
                  />
                </label>
              </div>
              <div className="invite-item__grid">
                <label className="field">
                  <span>Starts</span>
                  <input
                    onChange={(event) => update(index, { startsAt: event.target.value })}
                    type="datetime-local"
                    value={row.startsAt}
                  />
                </label>
                <label className="field">
                  <span>Ends</span>
                  <input
                    onChange={(event) => update(index, { endsAt: event.target.value })}
                    type="datetime-local"
                    value={row.endsAt}
                  />
                </label>
                <label className="field">
                  <span>Where</span>
                  <input
                    onChange={(event) => update(index, { location: event.target.value })}
                    placeholder="Office, address, or call"
                    value={row.location}
                  />
                </label>
                <label className="field">
                  <span>Link</span>
                  <input
                    inputMode="url"
                    onChange={(event) => update(index, { url: event.target.value })}
                    placeholder="https://…"
                    type="url"
                    value={row.url}
                  />
                </label>
              </div>
              <div className="invite-item__foot">
                <label className="invite-item__cancelled">
                  <input
                    checked={row.cancelled}
                    onChange={(event) => update(index, { cancelled: event.target.checked })}
                    type="checkbox"
                  />
                  <span>Cancelled</span>
                </label>
                <button
                  className="button button--quiet"
                  onClick={() => onChange(rows.filter((_, position) => position !== index))}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </fieldset>
          ))}
        </div>
      )}

      <div className="invite-field__actions">
        <button
          className="button button--quiet"
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <Upload aria-hidden="true" size={14} />
          Import .ics file
        </button>
        <button
          className="button button--quiet"
          onClick={() =>
            onChange([
              ...rows,
              {
                id: createUuidV7(),
                state: defaultState,
                summary: '',
                startsAt: '',
                endsAt: '',
                location: '',
                url: '',
                icsUid: null,
                sequence: 0,
                cancelled: false,
              },
            ])
          }
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
          Add invite manually
        </button>
      </div>
      <input
        accept="text/calendar,.ics"
        aria-label="Invite file"
        className="sr-only"
        onChange={(event) => {
          importIcs(event.target.files)
          event.target.value = ''
        }}
        ref={fileInputRef}
        type="file"
      />
      {message && (
        <p className="invite-field__notice" role="status">{message}</p>
      )}
      <p className="invite-field__hint">
        An <code>.ics</code> is the calendar attachment on a recruiter’s email; importing one fills
        in the time, place, and joining link. Re-importing a rescheduled invite updates the one it
        replaces instead of adding a second.
      </p>
    </div>
  )
}
