import { useCallback, useEffect, useRef } from 'react'

import { useDialogKeyboard } from './useDialogKeyboard'

/**
 * What is about to replace the tracker, what it holds now, and where else that lives —
 * the things that decide whether going ahead can lose anything.
 */
export type TrackerReplacement =
  | {
      kind: 'import'
      /** How many applications and attachment files the file brings. */
      incoming: number
      attachments: number
      /** How many the tracker holds now, all of which are replaced. */
      current: number
      /**
       * Whether a file the viewer holds already has everything current. A connected
       * folder does not count: the import writes into that same folder, so its copy is
       * the one being replaced.
       */
      backedUp: boolean
      /** The folder the import will overwrite, when one is connected. */
      folder: string | null
    }
  | {
      kind: 'remove'
      /** The tracker's name, as its tab and the switcher show it. */
      name: string
      current: number
      /**
       * As for an import, except that a connected folder does count: removing a tracker
       * deletes it from browser storage and never touches the folder, so its file is
       * left as the copy.
       */
      backedUp: boolean
      /** The folder that keeps its file, when one is connected. */
      folder: string | null
    }

/** `proceed` is the import or the removal; `save-then-proceed` downloads a copy first. */
export type ReplaceChoice = 'save-then-proceed' | 'proceed' | 'cancel'

export interface ReplaceTrackerDialogProps {
  replacement: TrackerReplacement
  onChoose: (choice: ReplaceChoice) => void
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function describe(replacement: TrackerReplacement): { title: string; body: string; verb: string } {
  const { current, backedUp, folder } = replacement
  const kept = backedUp
    ? 'Your last backup already has them.'
    : 'They are not saved anywhere else, so save a copy first if you might want them back.'

  /*
   * Removing means different things depending on where the tracker lives, so the body
   * opens with that rather than with "deletes": with a folder nothing is lost at all, and
   * only a tracker kept nowhere but this browser is really gone.
   */
  if (replacement.kind === 'remove') {
    const { name } = replacement
    const applications = plural(current, 'application')
    const are = current === 1 ? 'is' : 'are'
    const them = current === 1 ? 'it' : 'them'
    const body = folder
      ? `${name} stays in your ${folder} folder, with its ${applications}. Removing it only takes it off this browser's list, and From a folder… opens it again.`
      : backedUp
        ? `${name}'s ${applications} ${are} also in the file you last exported or imported. Removing it clears ${them} from this browser, and From a file… opens that file again.`
        : `${name}'s ${applications} ${are} only in this browser. Removing it deletes ${them} for good, so save a copy first if you might want ${them} back.`
    return { title: `Remove ${name} from this browser?`, body, verb: 'remove' }
  }

  const bringing = replacement.attachments > 0
    ? `${plural(replacement.incoming, 'application')} and ${plural(replacement.attachments, 'attachment')}`
    : plural(replacement.incoming, 'application')
  const where = folder ? `, here and in your ${folder} folder` : ''
  return {
    title: 'Replace your tracker?',
    body: `The file has ${bringing}. Importing it replaces the ${plural(current, 'application')} you have now${where}. ${kept}`,
    verb: 'import',
  }
}

/**
 * The question asked before anything replaces or removes a whole tracker — an import, or
 * removing a tracker from the browser. It is a dialog rather than `window.confirm` because the answer has three parts,
 * not two: someone who is about to lose applications no file holds should be offered the
 * copy, not only a yes or a no. When a file already holds everything the copy is not
 * offered — there is nothing it would keep — and the question goes back to a plain one.
 */
export function ReplaceTrackerDialog({ replacement, onChoose }: ReplaceTrackerDialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const cancel = useCallback(() => onChoose('cancel'), [onChoose])
  useDialogKeyboard(dialogRef, cancel)

  // Focus goes back to whatever held it, which is usually the control that asked.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    primaryRef.current?.focus()
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  const { title, body, verb } = describe(replacement)
  const capitalised = verb.charAt(0).toUpperCase() + verb.slice(1)

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.currentTarget === event.target && cancel()}
    >
      <section
        aria-describedby="replace-tracker-body"
        aria-labelledby="replace-tracker-title"
        aria-modal="true"
        className="dialog dialog--compact"
        ref={dialogRef}
        role="alertdialog"
        tabIndex={-1}
      >
        <div className="dialog__header">
          <h2 id="replace-tracker-title">{title}</h2>
        </div>
        <p className="dialog__body" id="replace-tracker-body">{body}</p>
        <div className="dialog__actions">
          {replacement.backedUp ? (
            <button
              className="button button--primary"
              onClick={() => onChoose('proceed')}
              ref={primaryRef}
              type="button"
            >
              {capitalised}
            </button>
          ) : (
            <>
              <button
                className="button button--primary"
                onClick={() => onChoose('save-then-proceed')}
                ref={primaryRef}
                type="button"
              >
                Save a copy, then {verb}
              </button>
              <button className="button button--danger" onClick={() => onChoose('proceed')} type="button">
                Discard and {verb}
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
