import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Columns2, CornerDownLeft, Keyboard, PanelLeft, Search, X } from 'lucide-react'
import {
  closeStageNoteEditor,
  openStageNoteInEditor,
  readStageNoteFromEditor,
  STATE_CONFIG,
  stateLabel,
  stateRank,
  type Application,
  type StageNote,
  type StageNoteDraft,
  type StageNoteEditSession,
  type StateId,
} from './domain'
import { QuickOpen, type QuickOpenEntry } from './QuickOpen'
import { PANEL_SHORTCUTS, shortcutKeys, shortcutLabel } from './shortcuts'
import { formatShortDate, formatTimeOfDay } from './views/viewUtils'
import {
  capturedMarkdown,
  buildSections,
  matchOffsets,
  outlineTree,
  parseMarkdown,
  searchNote,
  sectionAtLine,
  sectionHeadingLine,
  sectionPath,
  type OutlineNode,
} from './markdown'
import { FindWidget } from './FindWidget'
import { jumpToLine, lineAtOffset } from './noteEditorJump'
import { readHiddenRanges, toProjectedLine, toProjectedOffset, toSourceLine } from './noteFolds'
import { headingAtScrollTop, readingTopLine } from './noteScrollSpy'
import { NotesLayoutView } from './NotesLayoutView'
import {
  activateTab,
  closeGroup,
  closeTab,
  groupHolding,
  groupsOf,
  makeGroup,
  moveTab,
  noteRefKey,
  openInGroup,
  orderedRefs,
  resizeSplit,
  splitWith,
  type LayoutNode,
  type NoteRef,
  type TabGroup,
} from './notesLayout'
import { StageNotePane } from './StageNotePane'
import { stageNotePanelId, stageTabId } from './stageNoteIds'
import { useDialogKeyboard } from './useDialogKeyboard'

/**
 * How often the scratch file is re-read while a note is open in an external editor. The
 * server writes nothing on its own, so this is the only way changes come back.
 */
const EDITOR_POLL_MS = 1000

/**
 * How long typing pauses before the drafts that changed are written. Long enough that a
 * sentence is one write rather than one per key, short enough that closing the panel
 * straight after a thought is rare — and the flush on close catches it when it is not.
 */
export const AUTOSAVE_MS = 800

/** The pane the panel opens with. Named up front so no ref is read while rendering. */
const FIRST_PANE_ID = 'pane-1'

/** Names the sentence that tells a reader the tabs can be dragged or arrowed. */
const TABS_HINT_ID = 'stage-notes-tabs-hint'

/** The two bindings that arrange the panes, looked up rather than restated. */
const MOVE_TAB_SHORTCUT = PANEL_SHORTCUTS.find((shortcut) => shortcut.shift)!
const REORDER_TAB_SHORTCUT = PANEL_SHORTCUTS.find((shortcut) => shortcut.alt)!

/**
 * Drafts to store, grouped by the application they belong to. `applyStageNotes` allows one
 * draft per state in a call, so a panel holding two companies' notes cannot send one flat
 * list: the batches keep each application's stages apart.
 */
export interface StageNoteDraftBatch {
  applicationId: string
  drafts: StageNoteDraft[]
}

interface StageNotesDialogProps {
  /** Every application, so notes from any of them can be opened as a tab. */
  applications: Application[]
  /** The note the panel opens on, whose application's other noted stages open beside it. */
  initialRef: NoteRef
  onClose: () => void
  /**
   * Stores the notes whose drafts have changed since the last write. The panel writes as
   * it is typed into, so this commits without closing it and without a notice. Resolves
   * false when the write failed, which leaves those drafts pending for the next pause in
   * typing, or for the flush as the panel closes, to try again.
   */
  onSaveDrafts: (batches: StageNoteDraftBatch[]) => Promise<boolean>
  /** Commits a change that arrived from an external editor, which writes on its own. */
  onExternalChange: (applicationId: string, state: StateId, body: string) => Promise<void>
  /**
   * Stores one captured line against a stage, the moment it is entered rather than at the
   * next pause in typing: it is answered mid-conversation, where Escape and a closed tab
   * are likelier than a lull the autosave could ride on.
   */
  onCapture: (applicationId: string, state: StateId, line: string) => Promise<void>
  /**
   * Stores a rewritten captured line, or removes it when the text is blank. Like a
   * capture and unlike a draft, it is stored as it is entered: a correction to something
   * already written down has nothing a Save could still be waiting for.
   */
  onRevise: (applicationId: string, state: StateId, entryId: string, body: string) => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

/**
 * Orders the stages the panel opens with, the application's current stage first, so the
 * notes you need during an interview are the first thing on screen.
 */
function visibleStages(current: StateId, noted: StateId[]): StateId[] {
  const rest = [...new Set(noted)]
    .filter((state) => state !== current)
    .sort((left, right) => stateRank(left) - stateRank(right))
  return [current, ...rest]
}

interface OutlineListProps {
  nodes: readonly OutlineNode[]
  /** Nesting depth, which drives the indent guides and how loud a row reads. */
  depth: number
  /** The section under the scroll position, and every heading above it. */
  path: Set<string>
  current: string | null
  onPick: (key: string) => void
}

/**
 * The outline as a real tree: one list per level, so the hierarchy is in the markup
 * rather than only in the indentation. The path down to the section being read is
 * marked the whole way, which is what makes the shape of a long note readable at a
 * glance instead of having to be traced.
 */
function OutlineList({ nodes, depth, path, current, onPick }: OutlineListProps) {
  return (
    <ul
      aria-label={depth === 0 ? 'Outline' : undefined}
      className={`panel__outline${depth > 0 ? ' panel__outline--nested' : ''}`}
    >
      {nodes.map((node) => {
        const onPath = path.has(node.key)
        const isCurrent = node.key === current
        return (
          <li className={onPath ? 'panel__outline-branch--on-path' : undefined} key={node.key}>
            <button
              aria-current={isCurrent ? 'true' : undefined}
              aria-label={`Go to ${node.text}`}
              className={[
                'panel__outline-entry',
                isCurrent ? 'panel__outline-entry--current' : '',
                onPath && !isCurrent ? 'panel__outline-entry--ancestor' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-depth={Math.min(depth, 3)}
              onClick={() => onPick(node.key)}
              type="button"
            >
              {node.text}
            </button>
            {node.children.length > 0 ? (
              <OutlineList
                current={current}
                depth={depth + 1}
                nodes={node.children}
                onPick={onPick}
                path={path}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/*
 * The shortcuts the panel binds, listed where they are used. They are bound to the
 * document because the panel is modal, so there is no one control to hang them off and
 * nothing else on screen that would otherwise name them.
 *
 * A disclosure holding a plain list, the same shape as the topbar's More actions: Escape
 * closes it before the panel, an outside pointer dismisses it, and focus returns to the
 * trigger. Escape is stopped here rather than left to bubble, which is the debt every
 * overlay inside this panel owes `useDialogKeyboard`, as the find bar already pays.
 */
function ShortcutsHelp() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div
      className="panel__shortcuts"
      onKeyDown={(event) => {
        if (!open || event.key !== 'Escape') return
        // Handled on the way up from the trigger, not from a second document listener:
        // `useDialogKeyboard` is already bound to the document and was bound first, so
        // nothing added there could stop it. React's own handler runs before it does.
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }}
      ref={containerRef}
    >
      <button
        aria-expanded={open}
        aria-label="Keyboard shortcuts"
        className="icon-button"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <Keyboard aria-hidden="true" size={16} />
      </button>
      {open ? (
        <div
          aria-labelledby="stage-notes-shortcuts-title"
          className="panel__shortcuts-panel"
          role="group"
        >
          <p className="panel__shortcuts-title" id="stage-notes-shortcuts-title">
            Keyboard shortcuts
          </p>
          <dl className="panel__shortcuts-list">
            {PANEL_SHORTCUTS.map((shortcut) => (
              <div className="panel__shortcuts-row" key={shortcut.key}>
                {/* The key names the row, so it is the term and the sentence is the
                    definition — which is also the order a reader scans them in. */}
                <dt>
                  <kbd className="panel__shortcut-key">{shortcutLabel(shortcut.key)}</kbd>
                </dt>
                <dd>{shortcut.description}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  )
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/** One external editing session, with the note it belongs to. */
interface OpenSession {
  ref: NoteRef
  session: StageNoteEditSession
}

export function StageNotesDialog({
  applications,
  initialRef,
  onClose,
  onSaveDrafts,
  onExternalChange,
  onCapture,
  onRevise,
}: StageNotesDialogProps) {
  const dialogRef = useRef<HTMLElement>(null)

  const applicationsById = useMemo(
    () => new Map(applications.map((application) => [application.id, application])),
    [applications],
  )

  /** Every stored note, keyed the way the panel keys everything else. */
  const noteByKey = useMemo(() => {
    const entries: [string, StageNote][] = []
    for (const application of applications) {
      for (const note of application.stage_notes) {
        entries.push([noteRefKey({ applicationId: application.id, state: note.state }), note])
      }
    }
    return new Map(entries)
  }, [applications])

  const labelOf = useCallback(
    (ref: NoteRef) => {
      const company = applicationsById.get(ref.applicationId)?.company ?? 'Unknown'
      // The company leads because that is what tells two open notes apart; the stage is
      // the same word in both. Always present, even with one application open: a name
      // that grows a prefix when a second company arrives is not a stable name.
      return `${company} · ${stateLabel(ref.state)}`
    },
    [applicationsById],
  )

  /**
   * Ids for the panes this sitting creates. A counter rather than a uuid: it is only ever
   * compared with its own siblings, and a readable id makes a layout easy to follow.
   */
  const paneCount = useRef(1)
  const newId = useCallback(() => {
    paneCount.current += 1
    return `pane-${paneCount.current}`
  }, [])

  /**
   * The arrangement: which notes are open, how they are grouped into panes, and how those
   * panes are split. This replaces both the tab list and the pane list of the
   * single-application panel — a tab is a note in a group, so there is one thing to keep
   * right rather than two that had to agree.
   */
  const [layout, setLayout] = useState<LayoutNode>(() => {
    const application = applicationsById.get(initialRef.applicationId)
    const noted = application?.stage_notes.map((note) => note.state) ?? []
    const tabs = visibleStages(initialRef.state, noted).map((state) => ({
      applicationId: initialRef.applicationId,
      state,
    }))
    return makeGroup(FIRST_PANE_ID, tabs, noteRefKey(initialRef))
  })
  const layoutRef = useRef(layout)
  const [focusedGroupId, setFocusedGroupId] = useState<string>(FIRST_PANE_ID)
  const focusedGroupRef = useRef(focusedGroupId)

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  // The poll loop reads drafts outside of React's render cycle, so it needs a live copy.
  const draftsRef = useRef(drafts)
  /**
   * The text last written for each note, so a draft counts as pending only against what
   * actually reached the document. Compared against the draft rather than against the
   * stored note because `applyStageNotes` trims a body: a draft ending in a space would
   * otherwise never look written and would be re-sent at every pause in typing.
   */
  const [stored, setStored] = useState<Record<string, string>>({})
  const storedRef = useRef(stored)

  // Notes that already hold text open as readable outlines; empty ones open ready to type.
  const [editing, setEditing] = useState<string[]>([])
  /**
   * Notes whose captured lines are open for correcting. Held here rather than in the pane
   * for the same reason `editing` is: the find has to know, because a line in a box has no
   * highlight to step onto.
   */
  const [editingLines, setEditingLines] = useState<string[]>([])
  const [sessions, setSessions] = useState<Record<string, OpenSession>>({})
  const sessionsRef = useRef(sessions)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  /**
   * The tab being dragged, and the slot it is hovering over. Both are display state: they
   * exist for the length of one drag and describe nothing about the notes.
   */
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ groupId: string; index: number } | null>(null)

  // Find state. `findSeq` remounts the widget so a second Ctrl+F refocuses and selects
  // the query already in it, the way reopening find in an editor does.
  const [findOpen, setFindOpen] = useState(false)
  const [findSeq, setFindSeq] = useState(0)
  const [findQuery, setFindQuery] = useState('')
  const [matchCursor, setMatchCursor] = useState(0)
  const [quickOpen, setQuickOpen] = useState(false)
  /** The section the breadcrumbs name: the last heading scrolled past. */
  const [trailKey, setTrailKey] = useState<string | null>(null)
  /** Ancestors of an outline pick, force-opened so the jump lands somewhere folded open. */
  const [revealKeys, setRevealKeys] = useState<Set<string> | null>(null)
  const [pendingJumpKey, setPendingJumpKey] = useState<string | null>(null)
  /**
   * The heading picked from the outline, with the scroll position the jump settled at, so
   * the pick can outrank what layout reports until the reader scrolls somewhere else.
   */
  const pickedTrailRef = useRef<{ key: string; scrollTop: number } | null>(null)
  const notesRef = useRef<HTMLDivElement>(null)
  /** Each pane's scrolling element, by the id of the group drawing it. */
  const paneRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  // Held in a ref so the poll interval below is not torn down and restarted on every
  // render: the parent recreates this callback each time, and a commit causes a render.
  const externalChangeRef = useRef(onExternalChange)
  useEffect(() => {
    externalChangeRef.current = onExternalChange
  }, [onExternalChange])

  const saveDraftsRef = useRef(onSaveDrafts)
  useEffect(() => {
    saveDraftsRef.current = onSaveDrafts
  }, [onSaveDrafts])

  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useDialogKeyboard(dialogRef, onClose)

  // The panel covers the viewport and scrolls its own notes column, but the page behind
  // it can still be taller than the viewport. Without this the body keeps its own
  // scrollbar, doing nothing since the fixed panel blocks it, right beside the pane's.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  /**
   * Replaces the arrangement. Null means the last note just closed, which is the panel's
   * cue to go: with no note left there is nothing for it to be open for.
   */
  const applyLayout = useCallback((next: LayoutNode | null, focusGroupId?: string) => {
    if (!next) {
      closeRef.current()
      return
    }
    layoutRef.current = next
    setLayout(next)
    const ids = groupsOf(next).map((group) => group.id)
    setFocusedGroupId((current) => {
      if (focusGroupId && ids.includes(focusGroupId)) return focusGroupId
      return ids.includes(current) ? current : ids[0]
    })
  }, [])

  useEffect(() => {
    focusedGroupRef.current = focusedGroupId
  }, [focusedGroupId])

  const openRefs = useMemo(() => orderedRefs(layout), [layout])

  /**
   * Seeds a draft for every note as it joins the panel, so what is typed is measured
   * against what was stored rather than against nothing. A note already seeded is left
   * alone: re-seeding it from the document would throw away the keystrokes that have not
   * been written yet.
   */
  useEffect(() => {
    const missing = openRefs.filter((ref) => draftsRef.current[noteRefKey(ref)] === undefined)
    if (missing.length === 0) return
    const nextDrafts = { ...draftsRef.current }
    const nextStored = { ...storedRef.current }
    for (const ref of missing) {
      const key = noteRefKey(ref)
      const body = noteByKey.get(key)?.body ?? ''
      nextDrafts[key] = body
      nextStored[key] = body
    }
    draftsRef.current = nextDrafts
    storedRef.current = nextStored
    setDrafts(nextDrafts)
    setStored(nextStored)
    // A note opened with nothing in it opens ready to type, the way an empty stage always has.
    const blank = missing.filter((ref) => !(noteByKey.get(noteRefKey(ref))?.body ?? '').trim())
    if (blank.length > 0) {
      setEditing((current) => [...current, ...blank.map(noteRefKey).filter((key) => !current.includes(key))])
    }
  }, [noteByKey, openRefs])

  const setDraft = (key: string, value: string) => {
    draftsRef.current = { ...draftsRef.current, [key]: value }
    setDrafts(draftsRef.current)
  }

  const markStored = (key: string, body: string) => {
    storedRef.current = { ...storedRef.current, [key]: body }
    if (mountedRef.current) setStored(storedRef.current)
  }

  /** The open notes whose text differs from what was last written, by application. */
  const pendingBatches = (): StageNoteDraftBatch[] => {
    const byApplication = new Map<string, StageNoteDraft[]>()
    for (const ref of orderedRefs(layoutRef.current)) {
      const key = noteRefKey(ref)
      const body = draftsRef.current[key]
      if (body === undefined || body === storedRef.current[key]) continue
      const batch = byApplication.get(ref.applicationId) ?? []
      batch.push({ state: ref.state, body })
      byApplication.set(ref.applicationId, batch)
    }
    return [...byApplication].map(([applicationId, batch]) => ({ applicationId, drafts: batch }))
  }

  /**
   * Writes the notes that have changed, one write at a time. Every save PUTs the whole
   * document read from the parent's copy, so an overlapping one would be built on a
   * document the first has already replaced. Typing during a write is not lost: it is
   * still pending, so the loop picks it up before it lets go of the flag.
   *
   * Reads only refs, so it never changes identity and never restarts the debounce below.
   */
  const flushDrafts = useCallback(async () => {
    if (savingRef.current || pendingBatches().length === 0) return
    savingRef.current = true
    if (mountedRef.current) setSaving(true)
    try {
      for (let batches = pendingBatches(); batches.length > 0; batches = pendingBatches()) {
        const written = await saveDraftsRef.current(batches)
        // Left pending on failure, so the next pause in typing tries it again. The parent
        // raises the failure itself; a second notice here would say it twice.
        if (!written) break
        for (const batch of batches) {
          for (const draft of batch.drafts) {
            markStored(noteRefKey({ applicationId: batch.applicationId, state: draft.state }), draft.body)
          }
        }
        if (mountedRef.current) setSavedAt(new Date())
      }
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }, [])

  // Hung off `drafts` and nothing else: its identity changes only when a draft is edited,
  // never on a re-render, and every write re-renders the parent — anything else in the
  // dependencies would restart the wait on the panel's own writes and it would never fire.
  useEffect(() => {
    if (pendingBatches().length === 0) return
    const timer = window.setTimeout(() => void flushDrafts(), AUTOSAVE_MS)
    return () => window.clearTimeout(timer)
  }, [drafts, flushDrafts])

  const flushRef = useRef(flushDrafts)
  useEffect(() => {
    flushRef.current = flushDrafts
  }, [flushDrafts])

  /**
   * The keystrokes just before the panel closes are the ones most worth keeping, since the
   * wait has not run out on them yet. Every way out unmounts the panel — the close button,
   * Escape, the parent — so this one cleanup covers all of them. It writes after unmount,
   * which is safe: the callback is the parent's, and only this panel's state is skipped.
   */
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      void flushRef.current()
    }
  }, [])

  const openInEditor = async (ref: NoteRef) => {
    const key = noteRefKey(ref)
    setFormError(null)
    try {
      const session = await openStageNoteInEditor(
        ref.applicationId,
        ref.state,
        draftsRef.current[key] ?? '',
      )
      sessionsRef.current = { ...sessionsRef.current, [key]: { ref, session } }
      setSessions(sessionsRef.current)
      // The external editor owns this note while the session lasts.
      setEditing((current) => current.filter((entry) => entry !== key))
      // A scheme URL has to be opened by this browser: the server cannot reach an editor
      // on the machine looking at the page. The banner repeats it as a clickable fallback
      // in case the browser declines to follow a programmatic navigation.
      if (session.open_url) window.location.assign(session.open_url)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  const stopEditingExternally = async (ref: NoteRef) => {
    const key = noteRefKey(ref)
    const remaining = { ...sessionsRef.current }
    delete remaining[key]
    sessionsRef.current = remaining
    setSessions(remaining)
    try {
      await closeStageNoteEditor(ref.applicationId, ref.state)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  const activeSessionKey = Object.keys(sessions).sort().join(',')

  useEffect(() => {
    const keys = activeSessionKey ? activeSessionKey.split(',') : []
    if (keys.length === 0) return

    let cancelled = false
    const pull = async () => {
      for (const key of keys) {
        const open = sessionsRef.current[key]
        if (!open) continue
        try {
          const contents = await readStageNoteFromEditor(open.ref.applicationId, open.ref.state)
          if (cancelled || !contents) continue
          if ((draftsRef.current[key] ?? '') === contents.body) continue
          setDraft(key, contents.body)
          await externalChangeRef.current(open.ref.applicationId, open.ref.state, contents.body)
          // Stored by the line above, so the autosave has nothing left to write for this
          // note and the file coming back does not turn into a second write of itself.
          markStored(key, contents.body)
        } catch {
          // A transient read failure should not end the session; the next tick retries.
        }
      }
    }

    const timer = window.setInterval(pull, EDITOR_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeSessionKey])

  // Closing the dialog ends every session it started, so no scratch files are left behind.
  useEffect(() => {
    return () => {
      for (const open of Object.values(sessionsRef.current)) {
        void closeStageNoteEditor(open.ref.applicationId, open.ref.state)
      }
    }
  }, [])

  /**
   * Each note's captured lines, read as one note. Derived from what is stored rather than
   * from `drafts`, because a capture is written as it is typed: there is no unsaved version
   * of it, and Save must not be able to put one back the way it was.
   */
  const capturedByKey = useMemo(() => {
    const entries: [string, string][] = []
    for (const [key, note] of noteByKey) {
      entries.push([key, capturedMarkdown(note.heard, formatShortDate, formatTimeOfDay)])
    }
    return new Map(entries)
  }, [noteByKey])

  /** The same lines as records, with their stamps read, for correcting one at a time. */
  const linesByKey = useMemo(() => {
    const entries: [string, { id: string; body: string; stamp: string }[]][] = []
    for (const [key, note] of noteByKey) {
      entries.push([
        key,
        note.heard.map((entry) => ({
          id: entry.id,
          body: entry.body,
          stamp: formatTimeOfDay(entry.at),
        })),
      ])
    }
    return new Map(entries)
  }, [noteByKey])

  const groups = useMemo(() => groupsOf(layout), [layout])
  const activeGroup = groups.find((group) => group.id === focusedGroupId) ?? groups[0]
  const activeRef =
    activeGroup.tabs.find((tab) => noteRefKey(tab) === activeGroup.activeKey) ?? activeGroup.tabs[0]
  const activeKey = noteRefKey(activeRef)
  const activeBody = drafts[activeKey] ?? ''
  const activeLabel = labelOf(activeRef)
  const isSplit = groups.length > 1

  const activeApplication = applicationsById.get(activeRef.applicationId)
  const title = activeApplication
    ? [activeApplication.company, activeApplication.role].filter(Boolean).join(' — ')
    : ''
  const query = findOpen ? findQuery : ''

  const refByKey = useMemo(
    () => new Map(openRefs.map((ref) => [noteRefKey(ref), ref])),
    [openRefs],
  )

  /**
   * Where each note's matches sit in one list running through the panel, in layout order,
   * so stepping through the find crosses from one note into the next. Every open note is
   * searched, not only the ones on screen: a match in a tab you are not looking at is the
   * main thing a find is for. A note open in the Markdown editor sits its written text
   * out, because a textarea holds source and has no highlights to step onto — but its
   * captured lines are read the whole time and stay in the list.
   *
   * A note is counted as it renders: the written text first, then the captures below it,
   * with `written` recording where the second starts.
   */
  const findMatches = useCallback(
    (value: string) => {
      const perNote = new Map<
        string,
        { base: number; count: number; written: number; inEditor: boolean }
      >()
      const order: string[] = []
      let total = 0
      if (!value.trim()) return { perNote, order, total }

      const countIn = (source: string) =>
        source.trim() ? searchNote(buildSections(parseMarkdown(source)), value).count : 0

      for (const ref of openRefs) {
        const key = noteRefKey(ref)
        const inEditor = editing.includes(key) && !sessions[key]
        const source = drafts[key] ?? ''
        // A note being written is searched as the source it is. It carries no highlights,
        // so those matches are stepped onto by selecting them in the box instead — but
        // they are counted here with the rest, so one list runs through the whole panel.
        const written = inEditor ? matchOffsets(source, value).length : countIn(source)
        // Lines open for correcting still sit out: each is in a box of its own, and there
        // is no one place to send a caret that stands for all of them.
        const said = editingLines.includes(key) ? 0 : countIn(capturedByKey.get(key) ?? '')
        const count = written + said
        if (count === 0) continue
        perNote.set(key, { base: total, count, written, inEditor })
        order.push(key)
        total += count
      }
      return { perNote, order, total }
    },
    [capturedByKey, drafts, editing, editingLines, openRefs, sessions],
  )

  const matches = useMemo(() => findMatches(query), [findMatches, query])

  // The cursor runs unbounded so Next and Previous can wrap; this is where it lands.
  const currentMatch = matches.total === 0
    ? null
    : ((matchCursor % matches.total) + matches.total) % matches.total

  /** The note holding a given position in the panel-wide list of matches. */
  const noteOfMatch = (position: number): string | undefined =>
    matches.order.find((key) => {
      const found = matches.perNote.get(key)
      return found ? position >= found.base && position < found.base + found.count : false
    })

  useEffect(() => {
    if (currentMatch === null) return
    const target = notesRef.current?.querySelector<HTMLElement>(`[data-match-id="${currentMatch}"]`)
    // Guarded: jsdom has no layout, so it does not implement scrollIntoView.
    target?.scrollIntoView?.({ block: 'center' })
  }, [currentMatch, layout, query])

  /**
   * Puts a note on screen. One already open brings its pane into focus rather than being
   * opened twice: two copies would give one match two ids, and the find would step onto
   * whichever the DOM happened to return first.
   */
  const showRef = useCallback(
    (ref: NoteRef) => {
      const key = noteRefKey(ref)
      const holding = groupHolding(layoutRef.current, key)
      if (holding) {
        applyLayout(activateTab(layoutRef.current, holding.id, key), holding.id)
        return
      }
      const target = groupsOf(layoutRef.current).find((group) => group.id === focusedGroupId)
        ?? groupsOf(layoutRef.current)[0]
      applyLayout(openInGroup(layoutRef.current, target.id, ref), target.id)
    },
    [applyLayout, focusedGroupId],
  )

  const showKey = useCallback(
    (key: string) => {
      const ref = refByKey.get(key)
      if (ref) showRef(ref)
    },
    [refByKey, showRef],
  )

  /**
   * Brings a match that lives in a note being written into view. Focus stays in the find
   * bar so Enter keeps stepping, which means the box paints no selection of its own —
   * the highlight layer behind it is what shows the match, and this only has to scroll
   * the box to it. The mark on that layer is where its position is read from: measuring
   * a character offset in a textarea is otherwise guesswork.
   *
   * The selection is set all the same, unfocused and invisible, so clicking into the box
   * afterwards puts the caret on the hit rather than wherever it last was.
   */
  const revealInSource = (key: string | undefined, position: number) => {
    const found = key ? matches.perNote.get(key) : undefined
    if (!key || !found?.inEditor) return
    const index = position - found.base
    // Past the written note is the captured log, which renders marks like any note.
    if (index >= found.written) return
    const at = matchOffsets(drafts[key] ?? '', query)[index]
    if (at === undefined) return

    requestAnimationFrame(() => {
      const pane = notesRef.current
      const box = pane?.querySelector<HTMLTextAreaElement>(`[data-note-source="${key}"]`)
      if (!box) return
      // The box holds the note with its folded lines taken out. A fold holding a match is
      // open while the find is running, so the match itself is in there — but the lines
      // above it that are still folded are not, and the offset has to allow for them.
      const folds = readHiddenRanges(box)
      const start = toProjectedOffset(box.value, drafts[key] ?? '', folds, at)
      box.setSelectionRange(start, start + query.length)

      const mark = pane?.querySelector<HTMLElement>(`[data-source-match-id="${position}"]`)
      // Guarded: jsdom has no layout, so every offset it reports is 0.
      if (mark && box.clientHeight > 0) {
        box.scrollTop = Math.max(0, mark.offsetTop - box.clientHeight / 2)
      }
    })
  }

  /** Steps the find, following it into whichever note the next match lives in. */
  const stepMatch = (delta: number) => {
    if (matches.total === 0) return
    const next = matchCursor + delta
    setMatchCursor(next)
    const landing = ((next % matches.total) + matches.total) % matches.total
    const key = noteOfMatch(landing)
    if (key) showKey(key)
    revealInSource(key, landing)
  }

  /** A new query starts from its first match, in whichever note that turns out to be. */
  const changeQuery = (value: string) => {
    setFindQuery(value)
    setMatchCursor(0)
    const [first] = findMatches(value).order
    if (first) showKey(first)
  }

  const closeFind = () => {
    setFindOpen(false)
    setFindQuery('')
    dialogRef.current?.focus()
  }

  /** Bumping the sequence remounts the widget, which refocuses and selects the query. */
  const openFind = useCallback(() => {
    setFindOpen(true)
    setFindSeq((current) => current + 1)
  }, [])

  /**
   * Opens a second pane on a note the focused pane is not showing, or folds the panes back
   * into one. Unsplitting gathers every tab rather than dropping the panes it closes: a
   * pane is where a note is shown, not what keeps it open.
   */
  const toggleSplit = useCallback(() => {
    const current = layoutRef.current
    const list = groupsOf(current)
    if (list.length > 1) {
      const first = list[0]
      applyLayout(makeGroup(first.id, list.flatMap((group) => group.tabs), first.activeKey), first.id)
      return
    }
    const only = list[0]
    const other = only.tabs.find((tab) => noteRefKey(tab) !== only.activeKey)
    if (!other) return
    applyLayout(splitWith(current, only.id, 'right', other, newId), only.id)
  }, [applyLayout, newId])

  const closeNote = (groupId: string, key: string) => {
    applyLayout(closeTab(layoutRef.current, groupId, key))
  }

  /**
   * Moves one divider. Held in component state like everything else the panel arranges:
   * how wide a pane was left is display state, and must not reach a saved note.
   */
  const resizePane = useCallback(
    (splitId: string, dividerIndex: number, delta: number) => {
      applyLayout(resizeSplit(layoutRef.current, splitId, dividerIndex, delta))
    },
    [applyLayout],
  )

  /**
   * Lands a dragged or arrowed tab in a pane. The keyboard and the pointer share this so
   * the two cannot drift: whatever a drag can arrange, the arrows can arrange too, which
   * is the whole reason the layout operations are pure.
   */
  const dropTab = useCallback(
    (key: string, groupId: string, index: number) => {
      applyLayout(moveTab(layoutRef.current, key, groupId, index), groupId)
    },
    [applyLayout],
  )

  /**
   * Moves the tab being read into the pane beside it. Panes are stepped in layout order
   * rather than by measuring where they sit: the order is the order the tabs and the find
   * already run in, so the arrow agrees with what the reader has been stepping through.
   */
  const moveTabToNeighbour = useCallback(
    (step: -1 | 1) => {
      const tree = layoutRef.current
      const list = groupsOf(tree)
      const from = list.find((group) => group.id === focusedGroupRef.current) ?? list[0]
      const key = from.activeKey
      if (!key) return
      const target = list[list.indexOf(from) + step]
      // Nothing beside it to move into. Splitting one open here is what phase four adds.
      if (!target) return
      dropTab(key, target.id, step === 1 ? 0 : target.tabs.length)
    },
    [dropTab],
  )

  /** Reorders the tab being read within its own pane, wrapping at either end. */
  const reorderActiveTab = useCallback(
    (step: -1 | 1) => {
      const tree = layoutRef.current
      const list = groupsOf(tree)
      const group = list.find((entry) => entry.id === focusedGroupRef.current) ?? list[0]
      const key = group.activeKey
      if (!key || group.tabs.length < 2) return
      const index = group.tabs.findIndex((tab) => noteRefKey(tab) === key)
      const next = (index + step + group.tabs.length) % group.tabs.length
      dropTab(key, group.id, next)
    },
    [dropTab],
  )

  // Bound to the document rather than to the panel: the panel is modal, so nothing
  // inside it need hold focus for these to be the right thing to do.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === '\\') {
        event.preventDefault()
        toggleSplit()
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'f') {
        // Takes over the browser's own find, which cannot see into a folded note.
        event.preventDefault()
        openFind()
        return
      }
      if (key === 'p') {
        event.preventDefault()
        setQuickOpen(true)
        return
      }
      if (key === 'b') {
        event.preventDefault()
        setSidebarOpen((current) => !current)
        return
      }
      if (key === 'k') {
        event.preventDefault()
        // Found in the DOM rather than by index, so this listener does not have to be
        // rebound every time the focus moves from one pane to the other.
        notesRef.current?.querySelector<HTMLInputElement>('[data-capture-focus]')?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [openFind, toggleSplit])

  /*
   * Arranging the panes from the keyboard. A drag is the obvious way to move a tab and the
   * only way that is no way at all without a pointer, so every arrangement a drag can
   * reach has an arrow that reaches it too — the same requirement the Kanban's Move select
   * answers for dragging a card.
   *
   * Bound apart from the letter shortcuts because these carry a second modifier: folding
   * them into that listener would mean checking for the absence of Shift and Alt on every
   * one of the five, which is how Ctrl+Shift+F would quietly stop opening the find bar.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const step = event.key === 'ArrowRight' ? 1 : -1
      if (event.shiftKey && !event.altKey) {
        event.preventDefault()
        moveTabToNeighbour(step)
        return
      }
      if (event.altKey && !event.shiftKey) {
        event.preventDefault()
        reorderActiveTab(step)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [moveTabToNeighbour, reorderActiveTab])

  /**
   * What the picker can reach: every note already written, every application's current
   * stage, and — for the application being worked on — every stage it could still reach.
   * Listing all nineteen stages for all of them would be hundreds of rows, nearly all of
   * them notes nobody is going to write.
   */
  const pickable = useMemo(() => {
    const found = new Map<string, { ref: NoteRef; label: string }>()
    const add = (ref: NoteRef) => {
      const key = noteRefKey(ref)
      if (!found.has(key)) found.set(key, { ref, label: labelOf(ref) })
    }
    for (const application of applications) {
      add({ applicationId: application.id, state: application.state })
      for (const note of application.stage_notes) {
        add({ applicationId: application.id, state: note.state })
      }
    }
    for (const state of STATE_CONFIG) {
      add({ applicationId: activeRef.applicationId, state: state.id })
    }
    return found
  }, [activeRef.applicationId, applications, labelOf])

  const quickOpenEntries: QuickOpenEntry[] = useMemo(
    () =>
      [...pickable].map(([key, entry]) => ({
        id: key,
        label: entry.label,
        open: refByKey.has(key),
      })),
    [pickable, refByKey],
  )

  const openFromPicker = (key: string) => {
    const ref = pickable.get(key)?.ref
    if (ref) showRef(ref)
    setQuickOpen(false)
    dialogRef.current?.focus()
  }

  const editDraft = (key: string, value: string) => {
    setDraft(key, value)
  }

  const toggleEditing = (ref: NoteRef) => {
    const key = noteRefKey(ref)
    /*
     * Opening a note to write in it carries the place being read into the editor: someone
     * partway down a long note is reaching for the part they were reading, not the top.
     *
     * Which heading that is comes from the outline rather than from the top of the pane.
     * The two part company at the end of a note, where there is not enough left to scroll
     * the heading up to the header: the outline still marks the heading picked, which is
     * the one being read, while the pane still has an earlier one at the top.
     */
    if (!editing.includes(key)) {
      const holding = groupHolding(layout, key)
      const container = holding ? paneRefs.current[holding.id] : null
      const carried = key === activeKey ? trailKey : container && headingAtScrollTop(container)
      if (carried) setPendingJumpKey(carried)
    }

    setEditing((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    )
  }

  const activeSection = useMemo(() => buildSections(parseMarkdown(activeBody)), [activeBody])
  const outline = useMemo(() => outlineTree(activeSection), [activeSection])
  const trail = useMemo(() => sectionPath(activeSection, trailKey), [activeSection, trailKey])
  const trailKeys = useMemo(() => new Set(trail.map((entry) => entry.key)), [trail])

  /** Whether the pane the outline and breadcrumbs describe is being written in. */
  const editingActive = editing.includes(activeKey) && !sessions[activeKey]

  /**
   * Tracks the last heading scrolled past in the focused pane, for the breadcrumbs. Read
   * from layout rather than from the outline, because a folded heading is not on screen
   * to be inside. Each pane scrolls on its own, so this watches one of them.
   *
   * Stands aside while that pane is being written in: there are no rendered headings to
   * read a position off then, and the caret below says where the writer is instead.
   */
  useEffect(() => {
    const container = paneRefs.current[activeGroup.id]
    if (!container || editingActive) return

    let frame = 0
    const update = () => {
      frame = 0
      // A heading near the end of a note can never reach the top of the pane — the note
      // runs out of scroll first — so layout alone would report the heading above the one
      // just picked. While the pane still sits exactly where the jump left it, the pick
      // stands; the first real scroll from the reader drops it and tracking resumes.
      const picked = pickedTrailRef.current
      if (picked && Math.abs(container.scrollTop - picked.scrollTop) < 1) {
        setTrailKey(picked.key)
        return
      }
      pickedTrailRef.current = null
      setTrailKey(headingAtScrollTop(container))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    container.addEventListener('scroll', onScroll)
    // Deferred rather than called here, so no state is set during the effect itself.
    frame = requestAnimationFrame(update)
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [activeBody, activeGroup.id, activeKey, editing, editingActive])

  /**
   * Follows the caret while a note is being written, so the outline keeps saying which
   * part is being worked on rather than freezing wherever the editor was opened.
   *
   * `selectionchange` on the document is what reports a textarea caret moving, whichever
   * way it was moved — typed, arrowed, clicked, or set by a jump from the outline.
   */
  useEffect(() => {
    if (!editingActive) return
    const container = paneRefs.current[activeGroup.id]
    const editor = container?.querySelector<HTMLTextAreaElement>('.stage-note__editor textarea')
    if (!editor) return

    let frame = 0
    const update = () => {
      frame = 0
      // Only while the writing itself has the caret: the capture line at the foot of a
      // pane is a textarea too, and typing into it says nothing about the note above.
      if (document.activeElement !== editor) return
      // The box holds the note with its folded lines taken out, so the line the caret is
      // on there is not the line it is on in the note the outline describes.
      const line = toSourceLine(lineAtOffset(editor.value, editor.selectionStart), readHiddenRanges(editor))
      setTrailKey(sectionAtLine(activeSection, line))
    }
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    document.addEventListener('selectionchange', onChange)
    editor.addEventListener('input', onChange)
    // Deferred rather than called here, so no state is set during the effect itself.
    frame = requestAnimationFrame(update)
    return () => {
      document.removeEventListener('selectionchange', onChange)
      editor.removeEventListener('input', onChange)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [activeBody, activeGroup.id, activeSection, editingActive])

  const jumpToSection = (key: string) => {
    // A folded ancestor keeps the target heading out of the DOM entirely, so the scroll
    // below would silently do nothing — force its whole path open first, then jump once
    // that has rendered.
    setRevealKeys(new Set(sectionPath(activeSection, key).map((entry) => entry.key)))
    setPendingJumpKey(key)
  }

  useEffect(() => {
    if (!pendingJumpKey) return
    const container = paneRefs.current[activeGroup.id]
    if (!container) return

    /*
     * A note open for writing has no rendered headings to scroll to: the heading exists
     * only as the line it was typed on. Scoped to the editor's own box, because the
     * capture line at the foot of a pane is a textarea as well.
     */
    const editor = container.querySelector<HTMLTextAreaElement>('.stage-note__editor textarea')
    if (editor) {
      const line = sectionHeadingLine(activeSection, pendingJumpKey)
      // The heading's own fold path was revealed alongside this jump being set, so the box
      // is showing it by now — but the lines above it that are still folded away are not
      // in the box, and the jump has to count in the lines the box actually has.
      if (line !== null) {
        jumpToLine(editor, editor.value, toProjectedLine(line, readHiddenRanges(editor)))
      }
      pickedTrailRef.current = { key: pendingJumpKey, scrollTop: container.scrollTop }
      setTrailKey(pendingJumpKey)
      setPendingJumpKey(null)
      return
    }

    const heading = container.querySelector<HTMLElement>(`[data-section-key="${pendingJumpKey}"]`)
    if (!heading) return
    /*
     * A level 1 or 2 heading is sticky, and a pinned one measures — and scrolls — as the
     * line it is stuck to rather than as the place it occupies in the note. Both
     * `scrollIntoView` and the correction below would then be working from a position it
     * does not really hold: the jump barely moves, and where it ends up depends on where
     * the reader happened to be, so the same heading lands somewhere new each time.
     *
     * Holding it un-sticky for the measurement puts it back where the note actually has
     * it. Its ancestors stay sticky, so the line it has to clear is still the real one.
     */
    const stuckPosition = heading.style.position
    heading.style.position = 'static'
    try {
      // Optional call: jsdom has no layout and leaves scrollIntoView undefined, and the
      // panel still has to render there.
      heading.scrollIntoView?.({ block: 'start' })
      // Flush with the top is under the header, which then covers it. Correct by whatever
      // is actually left between the two rather than by an assumed header height. Repeated
      // because the first scroll is what pins the target's own sticky ancestor: the line it
      // has to clear does not exist to be measured until the note has moved.
      for (let pass = 0; pass < 3; pass += 1) {
        const gap = heading.getBoundingClientRect().top - readingTopLine(container, heading)
        if (Math.abs(gap) < 0.5) break
        const before = container.scrollTop
        container.scrollTop += gap
        // The note can run out of scroll before the heading reaches the line, and then the
        // gap never closes. Stop rather than spend the next pass asking again.
        if (container.scrollTop === before) break
      }
    } finally {
      heading.style.position = stuckPosition
    }
    // The reader named this heading, so it is the current one even if the note could not
    // scroll far enough to put it under the header.
    pickedTrailRef.current = { key: pendingJumpKey, scrollTop: container.scrollTop }
    setTrailKey(pendingJumpKey)
    setPendingJumpKey(null)
  }, [activeBody, activeGroup.id, activeSection, pendingJumpKey])

  const words = wordCount(activeBody)
  const openCount = openRefs.length

  /**
   * What the writing is doing, in the corner the writing is already being watched from.
   * `Waiting to save` is what makes a failed write visible: the drafts stay pending and
   * are tried again, and until one lands the panel should not claim to have stored them.
   */
  const pending = openRefs.some((ref) => {
    const key = noteRefKey(ref)
    return drafts[key] !== undefined && drafts[key] !== stored[key]
  })
  const saveLabel = saving
    ? 'Saving…'
    : pending
      ? 'Waiting to save'
      : savedAt
        ? `Saved ${formatTimeOfDay(savedAt.toISOString())}`
        : 'Saved'

  /*
   * One control, rendered in whichever of the two the sidebar currently is. It collapses
   * the outline, so it belongs beside the outline rather than up in the title bar among
   * the actions that act on the notes. That only works if collapsing leaves something
   * behind: a control inside the thing it hides has nowhere to be once it is hidden. So
   * the sidebar collapses to a rail holding just this button, and the button does not
   * move when it is pressed.
   */
  const outlineToggle = (
    <button
      aria-keyshortcuts={shortcutKeys('B')}
      aria-label={sidebarOpen ? 'Hide the outline' : 'Show the outline'}
      aria-pressed={sidebarOpen}
      className="icon-button"
      onClick={() => setSidebarOpen((current) => !current)}
      title={`${sidebarOpen ? 'Hide the outline' : 'Show the outline'} (${shortcutLabel('B')})`}
      type="button"
    >
      <PanelLeft aria-hidden="true" size={16} />
    </button>
  )

  /**
   * One pane: its own strip of tabs over the note on show. The tabs belong to the pane
   * rather than to the panel, which is what lets a note be moved from one pane to another
   * — a tab has somewhere to come from and somewhere to land.
   */
  const paneNumberOf = useCallback(
    (groupId: string) => groups.findIndex((entry) => entry.id === groupId) + 1,
    [groups],
  )

  const renderGroup = (group: TabGroup) => {
    const paneNumber = paneNumberOf(group.id)
    const shown =
      group.tabs.find((tab) => noteRefKey(tab) === group.activeKey) ?? group.tabs[0]
    const shownKey = noteRefKey(shown)
    const open = sessions[shownKey]
    const found = matches.perNote.get(shownKey)
    const isFocusedGroup = group.id === activeGroup.id
    const shownApplication = applicationsById.get(shown.applicationId)

    return (
      <div className="panel__group" key={group.id}>
        <div
          aria-describedby={TABS_HINT_ID}
          aria-label={`Prep note tabs, pane ${paneNumber}`}
          className="panel__tabs"
          onDragOver={(event) => {
            if (!dragging) return
            // Only the strip's own background: a slot handles its own hover, and letting
            // this run as well would fight it for where the tab is about to land.
            if (event.target !== event.currentTarget) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            setDropTarget({ groupId: group.id, index: group.tabs.length })
          }}
          onDrop={(event) => {
            if (event.target !== event.currentTarget) return
            event.preventDefault()
            const key = event.dataTransfer.getData('text/plain')
            if (key) dropTab(key, group.id, group.tabs.length)
            setDragging(null)
            setDropTarget(null)
          }}
          role="tablist"
        >
          {group.tabs.map((tab, tabIndex) => {
            const key = noteRefKey(tab)
            const label = labelOf(tab)
            const tabMatches = matches.perNote.get(key)
            const isActive = key === shownKey
            const application = applicationsById.get(tab.applicationId)
            const isDropTarget =
              dropTarget?.groupId === group.id && dropTarget.index === tabIndex
            return (
              // Presentational, so the tablist still owns the tabs themselves: a close
              // control cannot sit inside a button, and it belongs beside its own tab.
              <div
                className={[
                  'panel__tab-slot',
                  dragging === key ? 'panel__tab-slot--dragging' : '',
                  isDropTarget ? 'panel__tab-slot--drop-target' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={key}
                onDragLeave={(event) => {
                  // Guarded against a child's own dragleave, which would otherwise clear
                  // the highlight the moment the pointer crossed onto the tab's text.
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                  setDropTarget((current) =>
                    current?.groupId === group.id && current.index === tabIndex ? null : current,
                  )
                }}
                onDragOver={(event) => {
                  if (!dragging) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropTarget({ groupId: group.id, index: tabIndex })
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const dropped = event.dataTransfer.getData('text/plain')
                  if (dropped) dropTab(dropped, group.id, tabIndex)
                  setDragging(null)
                  setDropTarget(null)
                }}
                role="presentation"
              >
                <button
                  aria-controls={isActive ? stageNotePanelId(tab) : undefined}
                  aria-keyshortcuts={`${shortcutKeys(MOVE_TAB_SHORTCUT)} ${shortcutKeys(REORDER_TAB_SHORTCUT)}`}
                  aria-selected={isActive}
                  className={[
                    'panel__tab',
                    isActive ? 'panel__tab--open panel__tab--active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  draggable
                  id={stageTabId(tab)}
                  onClick={() => {
                    applyLayout(activateTab(layoutRef.current, group.id, key), group.id)
                  }}
                  onDragEnd={() => {
                    setDragging(null)
                    setDropTarget(null)
                  }}
                  onDragStart={(event) => {
                    setDragging(key)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', key)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                    event.preventDefault()
                    const step = event.key === 'ArrowRight' ? 1 : -1
                    const index = group.tabs.findIndex((entry) => noteRefKey(entry) === key)
                    const next = group.tabs[(index + step + group.tabs.length) % group.tabs.length]
                    const nextKey = noteRefKey(next)
                    applyLayout(activateTab(layoutRef.current, group.id, nextKey), group.id)
                    // Focus follows the selection, or the next arrow key would be read
                    // by the tab left behind and step from the wrong place.
                    tabRefs.current[nextKey]?.focus()
                  }}
                  ref={(node) => {
                    tabRefs.current[key] = node
                  }}
                  role="tab"
                  tabIndex={isActive ? 0 : -1}
                  type="button"
                >
                  {label}
                  {application?.state === tab.state ? (
                    <span className="panel__tab-badge">Current stage</span>
                  ) : null}
                  {tabMatches ? <span className="panel__tab-count">{tabMatches.count}</span> : null}
                </button>
                <button
                  aria-label={`Close the ${label} tab`}
                  className="icon-button panel__tab-close"
                  onClick={() => closeNote(group.id, key)}
                  title={`Close the ${label} tab. Its notes are kept.`}
                  type="button"
                >
                  <X aria-hidden="true" size={12} />
                </button>
              </div>
            )
          })}
        </div>

        <StageNotePane
          body={drafts[shownKey] ?? ''}
          captured={capturedByKey.get(shownKey) ?? ''}
          currentMatch={currentMatch}
          formatDate={formatShortDate}
          heardMatchBase={(found?.base ?? 0) + (found?.written ?? 0)}
          isCurrentState={shownApplication?.state === shown.state}
          isEditing={editing.includes(shownKey) && !open}
          isEditingLines={editingLines.includes(shownKey)}
          isFocused={isFocusedGroup}
          label={labelOf(shown)}
          lines={linesByKey.get(shownKey) ?? []}
          matchBase={found?.base ?? 0}
          noteRef={shown}
          onCapture={(line) => onCapture(shown.applicationId, shown.state, line)}
          onChange={(value) => editDraft(shownKey, value)}
          onClose={isSplit ? () => applyLayout(closeGroup(layoutRef.current, group.id)) : null}
          onFocus={() => setFocusedGroupId(group.id)}
          // Only the focused pane, which is the one the jump scrolls; a link clicked in
          // another pane focuses it first, so this is that pane by the time it lands.
          onJumpToSection={isFocusedGroup ? jumpToSection : undefined}
          onOpenInEditor={() => openInEditor(shown)}
          onRevise={(entryId, revised) =>
            onRevise(shown.applicationId, shown.state, entryId, revised)}
          onStopExternal={() => stopEditingExternally(shown)}
          onToggleEditLines={() =>
            setEditingLines((current) =>
              current.includes(shownKey)
                ? current.filter((entry) => entry !== shownKey)
                : [...current, shownKey],
            )}
          onToggleEditing={() => toggleEditing(shown)}
          paneRef={(node) => {
            paneRefs.current[group.id] = node
          }}
          query={query}
          revealKeys={isFocusedGroup ? (revealKeys ?? undefined) : undefined}
          saved={noteByKey.get(shownKey)}
          session={open?.session}
        />
      </div>
    )
  }

  return (
    <div className="dialog-backdrop dialog-backdrop--panel">
      {/* A panel fills the viewport, so there is no backdrop left to click away on. */}
      <section
        aria-labelledby="stage-notes-dialog-title"
        aria-modal="true"
        className="dialog dialog--panel"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="panel__titlebar">
          <div className="panel__title">
            <p className="dialog__subject">{title}</p>
            <h2 id="stage-notes-dialog-title">Stage prep notes</h2>
          </div>
          <button
            aria-keyshortcuts={shortcutKeys('\\')}
            aria-pressed={isSplit}
            className="button button--quiet panel__chrome-button"
            disabled={!isSplit && openCount < 2}
            onClick={toggleSplit}
            // Why it cannot be pressed outranks how to press it: a shortcut hint on a
            // dead control only invites the key that does nothing either.
            title={
              openCount < 2
                ? 'Only one note is open'
                : `${isSplit ? 'Close back to one pane' : 'Open a second pane'} (${shortcutLabel('\\')})`
            }
            type="button"
          >
            <Columns2 aria-hidden="true" size={14} />
            {isSplit ? 'Unsplit' : 'Split'}
          </button>
          <button
            aria-keyshortcuts={shortcutKeys('P')}
            className="button button--quiet panel__chrome-button"
            onClick={() => setQuickOpen(true)}
            title={`Open the note picker (${shortcutLabel('P')})`}
            type="button"
          >
            <CornerDownLeft aria-hidden="true" size={14} />
            Go to stage
          </button>
          <button
            aria-keyshortcuts={shortcutKeys('F')}
            className="button button--quiet panel__chrome-button"
            onClick={openFind}
            title={`Open the find bar (${shortcutLabel('F')})`}
            type="button"
          >
            <Search aria-hidden="true" size={14} />
            Find
          </button>
          <ShortcutsHelp />
          <button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={20} />
          </button>
        </div>

        <form
          className={`panel__body${sidebarOpen ? '' : ' panel__body--rail'}`}
          // There is nothing to submit — the notes write themselves. The form element
          // stays because it carries the panel's layout, and because the capture box's
          // Enter guard is written against the panel being one form around every note.
          onSubmit={(event) => event.preventDefault()}
        >
          {sidebarOpen ? (
            <aside className="panel__sidebar">
              <div>
                <div className="panel__sidebar-head">
                  <p className="panel__sidebar-title">Outline</p>
                  {outlineToggle}
                </div>
                {outline.length > 0 ? (
                  <OutlineList
                    current={trailKey}
                    depth={0}
                    nodes={outline}
                    onPick={jumpToSection}
                    path={trailKeys}
                  />
                ) : (
                  <p className="stage-notes__hint">
                    {activeBody.trim()
                      ? 'This note has no headings to outline.'
                      : 'Nothing written for this stage yet.'}
                  </p>
                )}
              </div>

              <p className="stage-notes__hint">
                Notes save as you type. Clearing a stage’s removes its note, but not what you
                were told in it.
              </p>
            </aside>
          ) : (
            <div className="panel__rail">{outlineToggle}</div>
          )}

          <div className="panel__main">
            <p className="panel__breadcrumbs">
              <span className="panel__crumb">{activeLabel}</span>
              {trail.map((crumb) => (
                <span className="panel__crumb" key={crumb.key}>
                  <ChevronRight aria-hidden="true" size={12} />
                  {crumb.text}
                </span>
              ))}
            </p>

            {findOpen ? (
              <FindWidget
                current={currentMatch}
                key={findSeq}
                onClose={closeFind}
                onNext={() => stepMatch(1)}
                onPrevious={() => stepMatch(-1)}
                onQuery={changeQuery}
                query={findQuery}
                total={matches.total}
              />
            ) : null}

            {quickOpen ? (
              <QuickOpen
                entries={quickOpenEntries}
                onClose={() => {
                  setQuickOpen(false)
                  dialogRef.current?.focus()
                }}
                onPick={openFromPicker}
              />
            ) : null}

            {/* The only way a drag is discoverable without a pointer, and the only way
                its keyboard equivalent is discoverable at all. */}
            <p className="sr-only" id={TABS_HINT_ID}>
              Drag a tab to reorder it or move it to another pane, or use
              {' '}{shortcutLabel(MOVE_TAB_SHORTCUT)} to move it between panes and
              {' '}{shortcutLabel(REORDER_TAB_SHORTCUT)} to reorder it.
            </p>

            <div
              className={`panel__notes${isSplit ? ' panel__notes--split' : ''}`}
              ref={notesRef}
            >
              <NotesLayoutView
                node={layout}
                onResize={resizePane}
                paneNumber={paneNumberOf}
                renderGroup={renderGroup}
              />
            </div>

            <div className="panel__statusbar">
              <p className="panel__status">
                {words} {words === 1 ? 'word' : 'words'} in {activeLabel} · {openCount}{' '}
                {openCount === 1 ? 'note' : 'notes'} open
              </p>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              {/* Not a live region. It changes every few seconds while a note is being
                  written, and a screen reader reading each pause out would talk over the
                  note being dictated into it — which is what the panel is open for. */}
              <p className="panel__status panel__status--save">{saveLabel}</p>
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}
