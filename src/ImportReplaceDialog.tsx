import { useCallback, useEffect, useRef } from 'react'

import { useDialogKeyboard } from './useDialogKeyboard'

/**
 * What the tracker holds now, and where else it lives — the two things that decide
 * whether replacing it can lose anything.
 */
export interface ImportReplacement {
  /** How many applications the file brings. */
  incoming: number
  attachments: number
  /** How many the tracker holds now, all of which the import replaces. */
  current: number
  /**
   * Whether a file the viewer holds already has everything current: only true when
   * nothing but browser storage is written to and the last export or import covers it.
   * A connected folder is not a backup here — the import writes into that same folder,
   * so its copy is the one being replaced.
   */
  backedUp: boolean
  /** The folder the import will overwrite, when one is connected. */
  folder: string | null
}

export type ImportChoice = 'save-then-import' | 'import' | 'cancel'

export interface ImportReplaceDialogProps {
  replacement: ImportReplacement
  onChoose: (choice: ImportChoice) => void
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * The question an import asks before it replaces anything. It is a dialog rather than
 * `window.confirm` because the answer has three parts, not two: someone who is about to
 * lose applications no file holds should be offered the copy, not only a yes or a no.
 * When a file already holds everything, the copy is not offered — there is nothing it
 * would keep — and the question goes back to being a plain one.
 */
export function ImportReplaceDialog({ replacement, onChoose }: ImportReplaceDialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const cancel = useCallback(() => onChoose('cancel'), [onChoose])
  useDialogKeyboard(dialogRef, cancel)

  // Focus goes back to whatever held it, which is usually the import control.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    primaryRef.current?.focus()
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  const { incoming, attachments, current, backedUp, folder } = replacement
  const bringing = attachments > 0
    ? `${plural(incoming, 'application')} and ${plural(attachments, 'attachment')}`
    : plural(incoming, 'application')
  const where = folder ? `, here and in your ${folder} folder` : ''

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.currentTarget === event.target && cancel()}
    >
      <section
        aria-describedby="import-replace-body"
        aria-labelledby="import-replace-title"
        aria-modal="true"
        className="dialog dialog--compact"
        ref={dialogRef}
        role="alertdialog"
        tabIndex={-1}
      >
        <div className="dialog__header">
          <h2 id="import-replace-title">Replace your tracker?</h2>
        </div>
        <p className="dialog__body" id="import-replace-body">
          The file has {bringing}. Importing it replaces the {plural(current, 'application')}{' '}
          you have now{where}.{' '}
          {backedUp
            ? 'Your last backup already has them.'
            : 'They are not saved anywhere else, so save a copy first if you might want them back.'}
        </p>
        <div className="dialog__actions">
          {backedUp ? (
            <button
              className="button button--primary"
              onClick={() => onChoose('import')}
              ref={primaryRef}
              type="button"
            >
              Import
            </button>
          ) : (
            <>
              <button
                className="button button--primary"
                onClick={() => onChoose('save-then-import')}
                ref={primaryRef}
                type="button"
              >
                Save a copy, then import
              </button>
              <button className="button button--danger" onClick={() => onChoose('import')} type="button">
                Discard and import
              </button>
            </>
          )}
          <span className="dialog__actions-spacer" />
          <button className="button" onClick={cancel} type="button">
            Cancel
          </button>
        </div>
      </section>
    </div>
  )
}
