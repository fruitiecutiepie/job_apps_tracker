import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'

import {
  DEFAULT_ROUNDS,
  defaultStageLabel,
  roundId,
  roundNumber,
  stageInUse,
  type StageConfig,
  type StageSetting,
  type TrackerDocument,
} from './domain'
import { useDialogKeyboard } from './useDialogKeyboard'

interface StagesDialogProps {
  tracker: TrackerDocument
  stages: StageConfig
  onClose: () => void
  onSave: (stages: StageSetting[]) => void
}

/**
 * Where a tracker's stages are named and its rounds counted. A form with a Save rather than a
 * write per keystroke, because a half-typed name would otherwise be what every card, column
 * and filter says until the typing stops. Rounds are added after the last one and taken away
 * from the end only, so no round is ever renumbered under what is filed against it.
 */
export function StagesDialog({ tracker, stages, onClose, onSave }: StagesDialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<StageSetting[]>(() => stages.stages.map(({ id, label }) => ({ id, label })))

  useDialogKeyboard(dialogRef, onClose)
  useEffect(() => {
    // The More actions trigger, which the menu hands focus back to as it closes.
    const opener = document.activeElement
    firstRef.current?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  const rounds = rows.filter(({ id }) => roundNumber(id) !== null).length
  const lastRound = roundId(rounds)
  // A round only this draft added holds nothing yet, whatever the document says.
  const lastRoundHeld = rounds <= stages.rounds && stageInUse(tracker, lastRound)
  const canRemove = rounds > DEFAULT_ROUNDS && !lastRoundHeld

  const rename = (id: string, label: string) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, label } : row)))
  }

  const addRound = () => {
    const added = roundId(rounds + 1)
    setRows((current) => {
      const at = current.findIndex(({ id }) => id === lastRound) + 1
      return [...current.slice(0, at), { id: added, label: defaultStageLabel(added) }, ...current.slice(at)]
    })
  }

  const removeRound = () => {
    if (canRemove) setRows((current) => current.filter(({ id }) => id !== lastRound))
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <section
        aria-describedby="stages-dialog-body"
        aria-labelledby="stages-dialog-title"
        aria-modal="true"
        className="dialog dialog--compact"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSave(rows)
          }}
        >
          <div className="dialog__header">
            <h2 id="stages-dialog-title">Stages</h2>
          </div>
          <p className="dialog__body" id="stages-dialog-body">
            A new name shows everywhere the stage does. Nothing filed under it moves.
          </p>
          <ol className="stage-list">
            {rows.map(({ id, label }, index) => {
              const fallback = defaultStageLabel(id)
              const isLastRound = id === lastRound
              return (
                <li className="stage-list__row" key={id}>
                  <input
                    aria-label={`Name for ${fallback}`}
                    onChange={(event) => rename(id, event.target.value)}
                    placeholder={fallback}
                    ref={index === 0 ? firstRef : undefined}
                    type="text"
                    value={label}
                  />
                  {isLastRound && rounds > DEFAULT_ROUNDS && (
                    <button
                      aria-label={`Remove ${fallback}`}
                      className="icon-button"
                      disabled={!canRemove}
                      onClick={removeRound}
                      title={canRemove
                        ? `Remove ${fallback}`
                        : `${fallback} cannot be removed while anything is filed under it`}
                      type="button"
                    >
                      <X aria-hidden="true" size={16} />
                    </button>
                  )}
                  {isLastRound && (
                    <button className="button stage-list__add" onClick={addRound} type="button">
                      <Plus aria-hidden="true" size={16} /> Add round
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
          <div className="dialog__actions">
            <button className="button button--primary" type="submit">
              Save
            </button>
            <span className="dialog__actions-spacer" />
            <button className="button" onClick={onClose} type="button">
              Cancel
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
