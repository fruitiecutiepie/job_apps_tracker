import { useCallback, useEffect, useRef, useState } from 'react'

import { useDialogKeyboard } from './useDialogKeyboard'

/**
 * What is about to replace or remove a tracker, what it holds now, and where else that
 * lives — the things that decide whether going ahead can lose anything.
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
      /**
       * The tracker on screen, when the file could instead open as a tracker of its own —
       * wherever a browser holds several. Null on the dev server, which holds one file.
       */
      openAsNewBeside: string | null
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

/**
 * A file that is already one of this browser's trackers: the `tracker.json` of the folder it
 * saves to, or the file it was opened from. Matched by the browser comparing the two
 * files, never by what they hold, so two files that happen to read alike are not confused.
 */
export interface ExistingTracker {
  kind: 'existing'
  /** The tracker the file belongs to. */
  name: string
  /** The dropped or picked file's own name. */
  file: string
  /** The folder whose tracker.json it is; null when it is the file the tracker came from. */
  folder: string | null
}

/**
 * `proceed` is the import or the removal; `save-then-proceed` downloads a copy first;
 * `open-new` opens an imported file as a tracker of its own instead of replacing anything.
 */
export type ReplaceChoice = 'save-then-proceed' | 'proceed' | 'open-new' | 'switch' | 'cancel'

export interface ReplaceTrackerDialogProps {
  replacement: TrackerReplacement | ExistingTracker
  onChoose: (choice: ReplaceChoice) => void
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function describe(replacement: TrackerReplacement): { title: string; body: string; verb: string } {
  const { current, backedUp, folder } = replacement
  const are = current === 1 ? 'is' : 'are'
  const them = current === 1 ? 'it' : 'them'

  /*
   * Removing means different things depending on where the tracker lives, so the body
   * opens with that rather than with "deletes": with a folder nothing is lost at all, and
   * only a tracker kept nowhere but this browser is really gone.
   */
  if (replacement.kind === 'remove') {
    const { name } = replacement
    const applications = plural(current, 'application')
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
  /*
   * With a folder connected the applications are not only in this browser, so saying they
   * are "not saved anywhere else" would be false. What is true is that the import writes
   * into that folder too, so afterwards neither copy has them.
   */
  const replaces = `Importing it replaces the ${plural(current, 'application')} you have now`
  const Them = current === 1 ? 'It' : 'They'
  const outcome = folder
    ? `${replaces}, here and in your ${folder} folder. A copy of ${them} is kept in that folder first.`
    : backedUp
      ? `${replaces}. The file you last exported or imported already has ${them}.`
      : replacement.openAsNewBeside === null
        // The dev server: one file on disk, which the import overwrites.
        ? `${replaces}. Nothing else holds ${them}, so save a copy first if you might want ${them} back.`
        : `${replaces}. ${Them} ${are} only in this browser, so save a copy first if you might want ${them} back.`
  const verb = replacement.openAsNewBeside ? 'replace' : 'import'
  return { title: 'Replace your tracker?', body: `The file has ${bringing}. ${outcome}`, verb }
}

/**
 * The question asked before anything replaces or removes a whole tracker — an import, or
 * removing a tracker from the browser. It is a dialog rather than `window.confirm` because
 * the answer has more than two parts: someone who is about to lose applications no file
 * holds should be offered the copy, not only a yes or a no. When a file already holds
 * everything the copy is not offered — there is nothing it would keep.
 *
 * Where a browser holds several trackers, an imported file need not replace anything: it
 * can open as a tracker of its own. That is asked first, as the main answer, and replacing
 * is the second; only choosing to replace leads on to the copy, and only when something
 * would be lost. Asking about a copy before anyone has chosen to replace would be asking
 * the wrong question first.
 */
export function ReplaceTrackerDialog({ replacement, onChoose }: ReplaceTrackerDialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const cancel = useCallback(() => onChoose('cancel'), [onChoose])
  useDialogKeyboard(dialogRef, cancel)
  const beside = replacement.kind === 'import' ? replacement.openAsNewBeside : null
  const [replacing, setReplacing] = useState(beside === null)

  // Focus goes back to whatever held it, which is usually the control that asked.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  // On to the main answer of whichever step is showing.
  useEffect(() => {
    primaryRef.current?.focus()
  }, [replacing])

  if (replacement.kind === 'existing') {
    const { name, file, folder } = replacement
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
            <h2 id="replace-tracker-title">{name} is already in this browser</h2>
          </div>
          <p className="dialog__body" id="replace-tracker-body">
            {folder
              ? `${file} is the file ${name} saves to, in your ${folder} folder.`
              : `${file} is the file ${name} was opened from.`}{' '}
            Switch to {name}, or open the file as a separate tracker beside it.
          </p>
          <div className="dialog__actions">
            <button
              className="button button--primary"
              onClick={() => onChoose('switch')}
              ref={primaryRef}
              type="button"
            >
              Switch to {name}
            </button>
            <button className="button" onClick={() => onChoose('open-new')} type="button">
              Open as a new tracker
            </button>
            <span className="dialog__actions-spacer" />
            <button className="button" onClick={cancel} type="button">
              Cancel
            </button>
          </div>
        </section>
      </div>
    )
  }

  if (beside !== null && !replacing && replacement.kind === 'import') {
    const bringing = replacement.attachments > 0
      ? `${plural(replacement.incoming, 'application')} and ${plural(replacement.attachments, 'attachment')}`
      : plural(replacement.incoming, 'application')
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
            <h2 id="replace-tracker-title">Open this file?</h2>
          </div>
          <p className="dialog__body" id="replace-tracker-body">
            The file has {bringing}. Open it as a tracker of its own beside {beside}, or replace
            what {beside} holds with it.
            {replacement.folder !== null && (
              <> Replacing keeps a copy of what {beside} holds now in your {replacement.folder} folder first.</>
            )}
          </p>
          <div className="dialog__actions">
            <button
              className="button button--primary"
              onClick={() => onChoose('open-new')}
              ref={primaryRef}
              type="button"
            >
              Open as a new tracker
            </button>
            <button
              className="button"
              onClick={() => (replacement.backedUp ? onChoose('proceed') : setReplacing(true))}
              type="button"
            >
              Replace {beside}
            </button>
            <span className="dialog__actions-spacer" />
            <button className="button" onClick={cancel} type="button">
              Cancel
            </button>
          </div>
        </section>
      </div>
    )
  }

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
