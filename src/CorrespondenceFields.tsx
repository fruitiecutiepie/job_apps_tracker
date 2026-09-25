import { Fragment, useEffect, useRef, useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import { CHANNEL_SUGGESTIONS, CORRESPONDENCE_CONFIG, STATE_CONFIG, createUuidV7 } from './domain'
import type { StateId } from './domain'
import {
  correspondenceRowSummary,
  newCorrespondenceRow,
  newThreadRow,
  opensThread,
  type CorrespondenceRow,
} from './correspondence'

const CHANNEL_LIST_ID = 'correspondence-channels'

/**
 * The box this element scrolls inside — the first ancestor that scrolls at all, and no further.
 *
 * `scrollIntoView` walks **every** scrollable ancestor, and the dialog's backdrop is one of
 * them: `position: fixed`, `overflow-y: auto`, `place-items: center`. Scrolling that shifts the
 * whole centred dialog inside a fixed overlay and clips it at the edges, which is what it did.
 */
function scrollBox(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return parent
  }
  return null
}

interface CorrespondenceFieldsProps {
  rows: CorrespondenceRow[]
  defaultState: StateId
  /**
   * A stage whose messages start open, and which this section scrolls to. Set when the
   * dialog was opened from a message rather than from the application: landing at the top of
   * a long form to hunt for the row you were just reading is the whole of the annoyance.
   */
  messagesFor?: StateId
  onChange: (rows: CorrespondenceRow[]) => void
}

export function CorrespondenceFields({
  rows,
  defaultState,
  messagesFor,
  onChange,
}: CorrespondenceFieldsProps) {
  /*
   * Which rows are showing their fields. A message is a record with six controls and an email
   * in it — five of them come to four screens of a dialog whose job is the application, not
   * the thread — so a row reads as one line until it is the one being worked on. Held here
   * rather than lifted: it is which row you are looking at, and it means nothing once the
   * dialog closes.
   */
  const [open, setOpen] = useState<string[]>(() =>
    messagesFor ? rows.filter((row) => row.state === messagesFor).map((row) => row.id) : [],
  )

  /*
   * Once, on the way in. Re-running it would drag the reader back here every time the rows
   * changed, and they are changing because the reader is typing into them.
   *
   * Focus as well as scroll, and the focus is the part that matters: the dialog autofocuses
   * its first field, which scrolls the form back to the top — so a scroll on its own is undone
   * a frame later. Landing on the section's own name also gives a screen reader somewhere to
   * be that says where it is, rather than dropping it into a textarea mid-form. Scrolled after
   * focusing rather than by it, because `focus()` scrolls as little as it can get away with
   * and this wants the section at the top.
   */
  const heading = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!messagesFor) return
    const box = heading.current
    if (!box) return
    box.focus({ preventScroll: true })
    const scroller = scrollBox(box)
    if (!scroller) return
    scroller.scrollTop += box.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  }, [messagesFor])

  /** Puts a row into the list at `index`, open, since it is the one about to be filled in. */
  const insert = (added: CorrespondenceRow, index: number) => {
    setOpen((current) => [...current, added.id])
    onChange([...rows.slice(0, index), added, ...rows.slice(index)])
  }
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
      {/* Focusable only programmatically: it is where this section is entered from the panel,
          and a label nobody navigated to should not be a Tab stop. */}
      <span className="correspondence-field__name" ref={heading} tabIndex={-1}>
        Messages
      </span>

      {rows.length > 0 && (
        <div className="correspondence-list">
          {rows.map((row, index) => (
            <Fragment key={row.id}>
            {/*
              One line over the messages of a thread, the same grouping the log makes and on
              the same rule — a subject shared inside a stage. Between the rows rather than
              wrapped around them, so the list stays flat and a message's number stays its
              position in it.
            */}
            {opensThread(rows, index) ? (
              <div className="correspondence-thread">
                <span>{row.subject.trim()}</span>
                {/*
                  Added into the thread rather than at the top of the list, because the run is
                  where it belongs and a row carrying this subject anywhere else would open a
                  second heading saying the same words. This row is the newest of its thread,
                  so the new one goes just above it.
                */}
                <button
                  aria-label={`Add a message to ${row.subject.trim()}`}
                  className="button button--quiet correspondence-thread__add"
                  onClick={() => insert(newThreadRow(row, createUuidV7()), index)}
                  type="button"
                >
                  <Plus aria-hidden="true" size={13} />
                  {/* Short on screen, specific to a screen reader: a subject can be a
                      sentence, and every thread carries one of these. */}
                  Add
                </button>
              </div>
            ) : null}
            <fieldset className="correspondence-item">
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
              <label className="field">
                <span>Subject</span>
                <input
                  onChange={(event) => update(row.id, { subject: event.target.value })}
                  placeholder="What it was about, if it came with one"
                  value={row.subject}
                />
              </label>
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
            </Fragment>
          ))}
        </div>
      )}

      <div className="correspondence-field__actions">
        <button
          className="button button--quiet"
          onClick={() => insert(newCorrespondenceRow(rows, defaultState, createUuidV7()), 0)}
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
