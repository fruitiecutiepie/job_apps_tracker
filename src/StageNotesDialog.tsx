import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Columns2, CornerDownLeft, PanelLeft, Search, X } from 'lucide-react'
import {
  closeStageNoteEditor,
  openStageNoteInEditor,
  readStageNoteFromEditor,
  STATE_CONFIG,
  stateLabel,
  stateRank,
  type Application,
  type StageNoteDraft,
  type StageNoteEditSession,
  type StateId,
} from './domain'
import { QuickOpen, type QuickOpenEntry } from './QuickOpen'
import { formatShortDate, formatTimeOfDay } from './views/viewUtils'
import {
  capturedMarkdown,
  buildSections,
  outlineTree,
  parseMarkdown,
  searchNote,
  sectionPath,
  type OutlineNode,
} from './markdown'
import { FindWidget } from './FindWidget'
import { StageNotePane } from './StageNotePane'
import { stageNotePanelId, stageTabId } from './stageNoteIds'
import { useDialogKeyboard } from './useDialogKeyboard'

/**
 * How often the scratch file is re-read while a stage is open in an external editor. The
 * server writes nothing on its own, so this is the only way changes come back.
 */
const EDITOR_POLL_MS = 1000

/**
 * How long typing pauses before the drafts that changed are written. Long enough that a
 * sentence is one write rather than one per key, short enough that closing the panel
 * straight after a thought is rare — and the flush on close catches it when it is not.
 */
const AUTOSAVE_MS = 800

/**
 * The height of a stage's sticky header, matching --note-header. The breadcrumbs read it
 * to decide which heading has been scrolled past, since a heading sticks under it.
 */
const NOTE_HEADER_PX = 49

interface StageNotesDialogProps {
  application: Application
  onClose: () => void
  /**
   * Stores the stages whose drafts have changed since the last write. The panel writes
   * as it is typed into, so this commits without closing it and without a notice.
   * Resolves false when the write failed, which leaves those drafts pending for the next
   * pause in typing, or for the flush as the panel closes, to try again.
   */
  onSaveDrafts: (drafts: StageNoteDraft[]) => Promise<boolean>
  /** Commits a change that arrived from an external editor, which writes on its own. */
  onExternalChange: (state: StateId, body: string) => Promise<void>
  /**
   * Stores one captured line against a stage, the moment it is entered rather than at the
   * next pause in typing: it is answered mid-conversation, where Escape and a closed tab
   * are likelier than a lull the autosave could ride on.
   */
  onCapture: (state: StateId, line: string) => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

/**
 * Orders the stages on show with the application's current stage first, so the notes you
 * need during an interview are the first thing on screen.
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

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

export function StageNotesDialog({
  application,
  onClose,
  onSaveDrafts,
  onExternalChange,
  onCapture,
}: StageNotesDialogProps) {
  const dialogRef = useRef<HTMLElement>(null)
  const [drafts, setDrafts] = useState<Partial<Record<StateId, string>>>(() =>
    Object.fromEntries(application.stage_notes.map((note) => [note.state, note.body])),
  )
  // The poll loop reads drafts outside of React's render cycle, so it needs a live copy.
  const draftsRef = useRef(drafts)
  /**
   * The text last written for each stage, so a draft counts as pending only against what
   * actually reached the document. Compared against the draft rather than against the
   * stored note because `applyStageNotes` trims a body: a draft ending in a space would
   * otherwise never look written and would be re-sent at every pause in typing.
   *
   * State as well as a ref, the way the drafts themselves are: the write loop reads it
   * outside a render, and the status bar reads it during one.
   */
  const [stored, setStored] = useState<Partial<Record<StateId, string>>>(() => ({ ...drafts }))
  const storedRef = useRef(stored)
  const [addedStages, setAddedStages] = useState<StateId[]>([])
  /** Stages taken off the tab bar for this sitting. Their notes are left where they are. */
  const [closedStages, setClosedStages] = useState<StateId[]>([])
  // Stages that already hold notes open as readable outlines; empty ones open ready to type.
  const [editing, setEditing] = useState<StateId[]>(() =>
    application.stage_notes.length > 0 ? [] : [application.state],
  )
  const [sessions, setSessions] = useState<Partial<Record<StateId, StageNoteEditSession>>>({})
  const sessionsRef = useRef(sessions)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)

  /**
   * The stages on screen, one per pane. A single pane gets the whole width; splitting
   * opens a second so two stages can be read against each other. A stage appears in at
   * most one pane, which also keeps every rendered match id unique.
   */
  const [panes, setPanes] = useState<StateId[]>([application.state])
  /** Index into `panes` of the one the outline, breadcrumbs, and find act on. */
  const [focused, setFocused] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Find state. `findSeq` remounts the widget so a second Ctrl+F refocuses and selects
  // the query already in it, the way reopening find in an editor does.
  const [findOpen, setFindOpen] = useState(false)
  const [findSeq, setFindSeq] = useState(0)
  const [findQuery, setFindQuery] = useState('')
  const [matchCursor, setMatchCursor] = useState(0)
  const [quickOpen, setQuickOpen] = useState(false)
  /** The section the breadcrumbs name: the last heading scrolled past. */
  const [trailKey, setTrailKey] = useState<string | null>(null)
  const notesRef = useRef<HTMLDivElement>(null)
  const paneRefs = useRef<(HTMLDivElement | null)[]>([])
  const tabRefs = useRef<Partial<Record<StateId, HTMLButtonElement | null>>>({})

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

  const setDraft = (state: StateId, value: string) => {
    draftsRef.current = { ...draftsRef.current, [state]: value }
    setDrafts(draftsRef.current)
  }

  /**
   * A draft the reader typed. Unlike one arriving from an external editor, the stage joins
   * the tab bar for the life of the panel: emptying a note removes it from the document a
   * moment later, and the pane must not disappear from under the caret that cleared it.
   */
  const editDraft = (state: StateId, value: string) => {
    setDraft(state, value)
    setAddedStages((current) => (current.includes(state) ? current : [...current, state]))
  }

  const markStored = (state: StateId, body: string) => {
    storedRef.current = { ...storedRef.current, [state]: body }
    if (mountedRef.current) setStored(storedRef.current)
  }

  const pendingDrafts = (): StageNoteDraft[] =>
    (Object.keys(draftsRef.current) as StateId[])
      .filter((state) => draftsRef.current[state] !== storedRef.current[state])
      .map((state) => ({ state, body: draftsRef.current[state] ?? '' }))

  /**
   * Writes the stages that have changed, one write at a time. Every save PUTs the whole
   * document read from the parent's copy, so an overlapping one would be built on a
   * document the first has already replaced. Typing during a write is not lost: it is
   * still pending, so the loop picks it up before it lets go of the flag.
   *
   * Reads only refs, so it never changes identity and never restarts the debounce below.
   */
  const flushDrafts = useCallback(async () => {
    if (savingRef.current || pendingDrafts().length === 0) return
    savingRef.current = true
    if (mountedRef.current) setSaving(true)
    try {
      for (let batch = pendingDrafts(); batch.length > 0; batch = pendingDrafts()) {
        const written = await saveDraftsRef.current(batch)
        // Left pending on failure, so the next pause in typing tries it again. The parent
        // raises the failure itself; a second notice here would say it twice.
        if (!written) break
        for (const draft of batch) markStored(draft.state, draft.body)
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
    if (pendingDrafts().length === 0) return
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

  const openInEditor = async (state: StateId) => {
    setFormError(null)
    try {
      const session = await openStageNoteInEditor(application.id, state, draftsRef.current[state] ?? '')
      sessionsRef.current = { ...sessionsRef.current, [state]: session }
      setSessions(sessionsRef.current)
      // The external editor owns this stage while the session lasts.
      setEditing((current) => current.filter((entry) => entry !== state))
      // A scheme URL has to be opened by this browser: the server cannot reach an editor
      // on the machine looking at the page. The banner repeats it as a clickable fallback
      // in case the browser declines to follow a programmatic navigation.
      if (session.open_url) window.location.assign(session.open_url)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  const stopEditingExternally = async (state: StateId) => {
    const remaining = { ...sessionsRef.current }
    delete remaining[state]
    sessionsRef.current = remaining
    setSessions(remaining)
    try {
      await closeStageNoteEditor(application.id, state)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  const activeSessionKey = Object.keys(sessions).sort().join(',')

  useEffect(() => {
    const states = activeSessionKey ? (activeSessionKey.split(',') as StateId[]) : []
    if (states.length === 0) return

    let cancelled = false
    const pull = async () => {
      for (const state of states) {
        try {
          const contents = await readStageNoteFromEditor(application.id, state)
          if (cancelled || !contents) continue
          if ((draftsRef.current[state] ?? '') === contents.body) continue
          setDraft(state, contents.body)
          await externalChangeRef.current(state, contents.body)
          // Stored by the line above, so the autosave has nothing left to write for this
          // stage and the file coming back does not turn into a second write of itself.
          markStored(state, contents.body)
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
  }, [activeSessionKey, application.id])

  // Closing the dialog ends every session it started, so no scratch files are left behind.
  useEffect(() => {
    const applicationId = application.id
    return () => {
      for (const state of Object.keys(sessionsRef.current)) {
        void closeStageNoteEditor(applicationId, state as StateId)
      }
    }
  }, [application.id])

  const stages = useMemo(
    () =>
      visibleStages(
        application.state,
        [...application.stage_notes.map((note) => note.state), ...addedStages].filter(
          (state) => !closedStages.includes(state),
        ),
      ),
    [addedStages, application.state, application.stage_notes, closedStages],
  )

  const noteByState = useMemo(
    () => new Map(application.stage_notes.map((note) => [note.state, note])),
    [application.stage_notes],
  )

  /**
   * Each stage's captured lines, read as one note. Derived from what is stored rather than
   * from `drafts`, because a capture is written as it is typed: there is no unsaved version
   * of it, and Save must not be able to put one back the way it was.
   */
  const capturedByState = useMemo(
    () =>
      new Map(
        application.stage_notes.map((note) => [
          note.state,
          capturedMarkdown(note.heard, formatShortDate, formatTimeOfDay),
        ]),
      ),
    [application.stage_notes],
  )

  const toggleEditing = (state: StateId) => {
    setEditing((current) =>
      current.includes(state) ? current.filter((entry) => entry !== state) : [...current, state],
    )
  }
  const title = [application.company, application.role].filter(Boolean).join(' — ')
  const query = findOpen ? findQuery : ''

  /**
   * Where each stage's matches sit in one list running through the panel, in tab order,
   * so stepping through the find crosses from one stage's note into the next. Every
   * stage is searched, not only the one on screen: a match in a tab you are not looking
   * at is the main thing a find is for. A stage open in the Markdown editor sits its
   * written note out, because a textarea holds source and has no highlights to step onto
   * — but its captured lines are read the whole time and stay in the list.
   *
   * A stage is counted as it renders: the written note first, then the captures below it,
   * with `written` recording where the second starts. Two separate notes on screen, and
   * the panel numbers them the way the reader's eye runs down them.
   */
  const findMatches = useCallback(
    (value: string) => {
      const perStage = new Map<StateId, { base: number; count: number; written: number }>()
      const order: StateId[] = []
      let total = 0
      if (!value.trim()) return { perStage, order, total }

      const countIn = (source: string) =>
        source.trim() ? searchNote(buildSections(parseMarkdown(source)), value).count : 0

      for (const state of stages) {
        const inEditor = editing.includes(state) && !sessions[state]
        const written = inEditor ? 0 : countIn(drafts[state] ?? '')
        const count = written + countIn(capturedByState.get(state) ?? '')
        if (count === 0) continue
        perStage.set(state, { base: total, count, written })
        order.push(state)
        total += count
      }
      return { perStage, order, total }
    },
    [capturedByState, drafts, editing, sessions, stages],
  )

  const matches = useMemo(() => findMatches(query), [findMatches, query])

  // The cursor runs unbounded so Next and Previous can wrap; this is where it lands.
  const currentMatch = matches.total === 0
    ? null
    : ((matchCursor % matches.total) + matches.total) % matches.total

  /** The stage holding a given position in the panel-wide list of matches. */
  const stageOfMatch = (position: number): StateId | undefined =>
    matches.order.find((state) => {
      const found = matches.perStage.get(state)
      return found ? position >= found.base && position < found.base + found.count : false
    })

  /**
   * Saving a cleared note drops its stage out of `stages`, which can leave a pane holding
   * one that is no longer open. Derived rather than corrected in an effect, so there is no
   * render where a pane shows a stage the tab bar has already forgotten.
   */
  const openPanes = useMemo(() => {
    const kept = panes.filter((state) => stages.includes(state))
    return kept.length > 0 ? kept : [stages[0]]
  }, [panes, stages])

  useEffect(() => {
    if (currentMatch === null) return
    const target = notesRef.current?.querySelector<HTMLElement>(`[data-match-id="${currentMatch}"]`)
    // Guarded: jsdom has no layout, so it does not implement scrollIntoView.
    target?.scrollIntoView?.({ block: 'center' })
  }, [currentMatch, openPanes, query])

  /**
   * Puts a stage on screen. A stage already in a pane brings that pane into focus rather
   * than being opened twice, so the two panes never hold the same note.
   */
  const showStage = (state: StateId) => {
    const already = openPanes.indexOf(state)
    if (already !== -1) {
      setFocused(already)
      return
    }
    setPanes((current) => current.map((entry, index) => (index === focused ? state : entry)))
  }

  /** Steps the find, following it into whichever stage the next match lives in. */
  const stepMatch = (delta: number) => {
    if (matches.total === 0) return
    const next = matchCursor + delta
    setMatchCursor(next)
    const landing = ((next % matches.total) + matches.total) % matches.total
    const stage = stageOfMatch(landing)
    if (stage) showStage(stage)
  }

  /** A new query starts from its first match, in whichever stage that turns out to be. */
  const changeQuery = (value: string) => {
    setFindQuery(value)
    setMatchCursor(0)
    const [first] = findMatches(value).order
    if (first) showStage(first)
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
   * Opens a second pane on the first stage not already on screen, or closes it again.
   * Nothing to split into when only one stage is open, which is why the control says so.
   */
  const toggleSplit = useCallback(() => {
    setPanes((current) => {
      if (current.length > 1) return [current[0]]
      const next = stages.find((state) => state !== current[0])
      return next ? [current[0], next] : current
    })
    setFocused(0)
  }, [stages])

  const closePane = (index: number) => {
    setPanes((current) => current.filter((_, entry) => entry !== index))
    setFocused(0)
  }

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

  /**
   * Takes a stage off the tab bar. It means off screen, not deleted: the note stays where
   * it is and the stage is listed again the next time the panel opens. The application's
   * own stage has no close control, so it is always somewhere to land.
   */
  const closeStage = (state: StateId) => {
    setClosedStages((current) => (current.includes(state) ? current : [...current, state]))
  }

  const openStage = (state: StateId) => {
    setClosedStages((current) => current.filter((entry) => entry !== state))
    if (!stages.includes(state)) {
      setAddedStages((current) => (current.includes(state) ? current : [...current, state]))
      // A stage reached this way with nothing in it opens ready to type. One that was
      // closed and picked again still has its note, so it opens to be read like the rest.
      if (!(drafts[state] ?? '').trim()) setEditing((current) => [...current, state])
    }
    showStage(state)
    setQuickOpen(false)
    dialogRef.current?.focus()
  }

  const quickOpenEntries: QuickOpenEntry[] = STATE_CONFIG.map((state) => ({
    id: state.id,
    label: state.label,
    open: stages.includes(state.id),
  }))

  // The focused pane is what the sidebar, breadcrumbs and status bar describe.
  const paneIndex = Math.min(focused, openPanes.length - 1)
  const activeStage = openPanes[paneIndex]
  const activeBody = drafts[activeStage] ?? ''
  const activeLabel = stateLabel(activeStage)
  const isSplit = openPanes.length > 1

  const activeSection = useMemo(
    () => buildSections(parseMarkdown(activeBody)),
    [activeBody],
  )
  const outline = useMemo(() => outlineTree(activeSection), [activeSection])
  const trail = useMemo(() => sectionPath(activeSection, trailKey), [activeSection, trailKey])
  const trailKeys = useMemo(() => new Set(trail.map((entry) => entry.key)), [trail])

  /**
   * Tracks the last heading scrolled past in the focused pane, for the breadcrumbs. Read
   * from layout rather than from the outline, because a folded heading is not on screen
   * to be inside. Each pane scrolls on its own, so this watches one of them.
   */
  useEffect(() => {
    const container = paneRefs.current[paneIndex]
    if (!container) return

    let frame = 0
    const update = () => {
      frame = 0
      const limit = container.getBoundingClientRect().top + NOTE_HEADER_PX
      let found: string | null = null
      for (const heading of container.querySelectorAll<HTMLElement>('[data-section-key]')) {
        if (heading.getBoundingClientRect().bottom > limit) break
        found = heading.dataset.sectionKey ?? null
      }
      setTrailKey(found)
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
  }, [activeBody, activeStage, editing, paneIndex])

  const jumpToSection = (key: string) => {
    paneRefs.current[paneIndex]
      ?.querySelector<HTMLElement>(`[data-section-key="${key}"]`)
      ?.scrollIntoView?.({ block: 'start' })
  }

  const words = wordCount(activeBody)

  /**
   * What the writing is doing, in the corner the writing is already being watched from.
   * `Waiting to save` is what makes a failed write visible: the drafts stay pending and
   * are tried again, and until one lands the panel should not claim to have stored them.
   */
  const pending = (Object.keys(drafts) as StateId[]).some((state) => drafts[state] !== stored[state])
  const saveLabel = saving
    ? 'Saving…'
    : pending
      ? 'Waiting to save'
      : savedAt
        ? `Saved ${formatTimeOfDay(savedAt.toISOString())}`
        : 'Saved'

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
            aria-label={sidebarOpen ? 'Hide the outline' : 'Show the outline'}
            aria-pressed={sidebarOpen}
            className="icon-button"
            onClick={() => setSidebarOpen((current) => !current)}
            type="button"
          >
            <PanelLeft aria-hidden="true" size={16} />
          </button>
          <button
            aria-pressed={isSplit}
            className="button button--quiet panel__chrome-button"
            disabled={!isSplit && stages.length < 2}
            onClick={toggleSplit}
            title={stages.length < 2 ? 'Only one stage is open' : undefined}
            type="button"
          >
            <Columns2 aria-hidden="true" size={14} />
            {isSplit ? 'Unsplit' : 'Split'}
          </button>
          <button
            className="button button--quiet panel__chrome-button"
            onClick={() => setQuickOpen(true)}
            type="button"
          >
            <CornerDownLeft aria-hidden="true" size={14} />
            Go to stage
          </button>
          <button
            className="button button--quiet panel__chrome-button"
            onClick={openFind}
            type="button"
          >
            <Search aria-hidden="true" size={14} />
            Find
          </button>
          <button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={20} />
          </button>
        </div>

        <form
          className={`panel__body${sidebarOpen ? '' : ' panel__body--no-sidebar'}`}
          // There is nothing to submit — the notes write themselves. The form element
          // stays because it carries the panel's layout, and because the capture box's
          // Enter guard is written against the panel being one form around every stage.
          onSubmit={(event) => event.preventDefault()}
        >
          {sidebarOpen ? (
          <aside className="panel__sidebar">
            <div>
              <p className="panel__sidebar-title">Outline</p>
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
          ) : null}

          <div className="panel__main">
            <div
              aria-label="Stages with prep notes"
              aria-multiselectable={isSplit ? true : undefined}
              className="panel__tabs"
              role="tablist"
            >
              {stages.map((state) => {
                const label = stateLabel(state)
                const found = matches.perStage.get(state)
                const onScreen = openPanes.includes(state)
                const isActive = state === activeStage
                // The application's own stage is always listed, so it carries no close
                // control: the panel must have somewhere to land whatever else is shut.
                const closable = state !== application.state
                return (
                  // Presentational, so the tablist still owns the tabs themselves: a close
                  // control cannot sit inside a button, and it belongs beside its own tab.
                  <div className="panel__tab-slot" key={state} role="presentation">
                  <button
                    aria-controls={onScreen ? stageNotePanelId(state) : undefined}
                    aria-selected={onScreen}
                    className={[
                      'panel__tab',
                      onScreen ? 'panel__tab--open' : '',
                      isActive ? 'panel__tab--active' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    id={stageTabId(state)}
                    onClick={() => showStage(state)}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                      event.preventDefault()
                      const step = event.key === 'ArrowRight' ? 1 : -1
                      const next = stages[(stages.indexOf(state) + step + stages.length) % stages.length]
                      showStage(next)
                      // Focus follows the selection, or the next arrow key would be read
                      // by the tab left behind and step from the wrong place.
                      tabRefs.current[next]?.focus()
                    }}
                    ref={(node) => {
                      tabRefs.current[state] = node
                    }}
                    role="tab"
                    tabIndex={isActive ? 0 : -1}
                    type="button"
                  >
                    {label}
                    {state === application.state ? (
                      <span className="panel__tab-badge">Current stage</span>
                    ) : null}
                    {found ? <span className="panel__tab-count">{found.count}</span> : null}
                  </button>
                  {closable ? (
                    <button
                      aria-label={`Close the ${label} tab`}
                      className="icon-button panel__tab-close"
                      onClick={() => closeStage(state)}
                      title={`Close the ${label} tab. Its notes are kept.`}
                      type="button"
                    >
                      <X aria-hidden="true" size={12} />
                    </button>
                  ) : null}
                  </div>
                )
              })}
            </div>

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
                onPick={openStage}
              />
            ) : null}

            <div
              className={`panel__notes${isSplit ? ' panel__notes--split' : ''}`}
              ref={notesRef}
            >
              {openPanes.map((state, index) => {
                const session = sessions[state]
                const found = matches.perStage.get(state)
                return (
                  <StageNotePane
                    body={drafts[state] ?? ''}
                    captured={capturedByState.get(state) ?? ''}
                    currentMatch={currentMatch}
                    formatDate={formatShortDate}
                    heardMatchBase={(found?.base ?? 0) + (found?.written ?? 0)}
                    isCurrentState={state === application.state}
                    isEditing={editing.includes(state) && !session}
                    isFocused={index === paneIndex}
                    key={state}
                    label={stateLabel(state)}
                    matchBase={found?.base ?? 0}
                    onCapture={(line) => onCapture(state, line)}
                    onChange={(value) => editDraft(state, value)}
                    onClose={isSplit ? () => closePane(index) : null}
                    onFocus={() => setFocused(index)}
                    onOpenInEditor={() => openInEditor(state)}
                    onStopExternal={() => stopEditingExternally(state)}
                    onToggleEditing={() => toggleEditing(state)}
                    paneRef={(node) => {
                      paneRefs.current[index] = node
                    }}
                    query={query}
                    saved={noteByState.get(state)}
                    session={session}
                    state={state}
                  />
                )
              })}
            </div>

            <div className="panel__statusbar">
              <p className="panel__status">
                {words} {words === 1 ? 'word' : 'words'} in {activeLabel} · {stages.length}{' '}
                {stages.length === 1 ? 'stage' : 'stages'} open
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
