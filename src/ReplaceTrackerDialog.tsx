import { useCallback, useEffect, useRef, useState } from 'react'

import { useDialogKeyboard } from './useDialogKeyboard'

/**
 * What is about to replace or remove a tracker, what it holds now, and where else that
 * lives — the things that decide whether going ahead can lose anything.
 */
export type TrackerReplacement =
  | {
      kind: 'import'
      /** The dropped or chosen file's name, so the question can say which file it means. */
      fileName: string
      /** How many the tracker holds now, all of which are replaced. */
      current: number
      /**
       * Whether going ahead loses nothing. Where a browser holds several trackers, replacing
       * closes the tracker on screen rather than writing over it, so this is what removing
       * it would lose: nothing with a folder, which is never touched, or when the last
       * export or import has everything. On the dev server replacing writes over its one
       * file, which nothing else holds.
       */
      backedUp: boolean
      /** The folder the tracker on screen saves to, when one is connected. */
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

/*
 * Every body here says only the effect of the action about to be taken, in as few words
 * as will carry it. The buttons already say what the choices are, and the counts and file
 * names the reader is looking at do not need restating; what they cannot see is what will
 * be lost, or that nothing will.
 */
function describe(replacement: TrackerReplacement): { title: string; body: string; verb: string } {
  const { current, backedUp, folder } = replacement
  const applications = plural(current, 'application')
  const are = current === 1 ? 'is' : 'are'

  if (replacement.kind === 'remove') {
    const body = folder
      ? `It stays in your ${folder} folder.`
      : backedUp
        ? 'Your last export or import has all of it.'
        : `Its ${applications} ${are} only in this browser and will be deleted.`
    return { title: `Remove ${replacement.name} from this browser?`, body, verb: 'remove' }
  }

  const tracker = replacement.openAsNewBeside
  if (tracker === null) {
    // The dev server: one file on disk, which the import writes over.
    return { title: 'Replace your tracker?', body: `Its ${applications} ${are} saved nowhere else.`, verb: 'import' }
  }
  // Only asked when closing would lose something: the applications are only here.
  return { title: `Close ${tracker}?`, body: `Its ${applications} ${are} only in this browser.`, verb: 'replace' }
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
            {folder ? `${file} is the file it saves to.` : `It was opened from ${file}.`}
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
            <h2 id="replace-tracker-title">Open {replacement.fileName}?</h2>
          </div>
          {/*
            * Replace goes ahead without a second question whenever nothing would be lost,
            * so this line is the only place that says what replacing does to the tracker
            * on screen, and why it is safe when it is.
            */}
          <p className="dialog__body" id="replace-tracker-body">
            {replacement.folder !== null
              ? `Replacing closes ${beside}; it stays in your ${replacement.folder} folder.`
              : replacement.backedUp
                ? `Replacing closes ${beside}; your last export or import has all of it.`
                : `Replacing closes ${beside}.`}
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
