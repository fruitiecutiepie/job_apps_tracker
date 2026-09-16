import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ChevronRight, Columns2, Keyboard, PanelLeft, Plus, Search, X } from 'lucide-react'
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
import { tabLabels } from './notesTabLabel'
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
  highestPaneNumber,
  makeGroup,
  moveTab,
  neighbourGroup,
  noteRefKey,
  openInGroup,
  orderedRefs,
  orderedTabs,
  parseNoteRefKey,
  parseTabId,
  placeTab,
  tabId,
  replaceTab,
  resizeSplit,
  splitEmpty,
  splitWith,
  type Edge,
  type LayoutNode,
  type NoteRef,
  type NoteRequest,
  type TabGroup,
} from './notesLayout'
import {
  captureHeightWithin,
  DEFAULT_CAPTURE_LOG,
  DEFAULT_SIDEBAR,
  SIDEBAR_STEP,
  MAX_SIDEBAR,
  MIN_SIDEBAR,
  MAX_OUTLINE_SHARE,
  MIN_OUTLINE_SHARE,
  OUTLINE_SHARE_STEP,
  DEFAULT_OUTLINE_SHARE,
  outlineShareWithin,
  sidebarWidthWithin,
  type Arrangement,
} from './notesArrangement'
import { NotesTreeView } from './NotesTreeView'
import { StageNotePane } from './StageNotePane'
import {
  DROP_EDGE,
  DROP_EDGE_PANE,
  DROP_SLOT_GROUP,
  DROP_SLOT_INDEX,
  useTabDrag,
} from './useTabDrag'
import { stageNotePanelId, stageTabId } from './stageNoteIds'

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

/** Names the sentence that tells a reader the tabs can be dragged or arrowed. */
const TABS_HINT_ID = 'stage-notes-tabs-hint'

/**
 * The bindings the tabs name, looked up rather than restated. By key as well as modifier:
 * two of these carry Alt, so a lookup by modifier alone would hand one of them the other's
 * label the moment a third Alt binding arrived — which is exactly what it did.
 */
/** Whether the keyboard belongs to a box being typed into rather than to the panel. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLInputElement
}

const byKey = (key: string, modifier: 'shift' | 'alt' | null) =>
  PANEL_SHORTCUTS.find((shortcut) => shortcut.key === key && (!modifier || shortcut[modifier]))!

const MOVE_TAB_SHORTCUT = byKey('←/→', 'shift')
/**
 * Not the arrows. `⌘⌥←/→` walks between browser tabs on macOS, so the page never saw it —
 * a binding the browser answers first is a binding this does not have. A comma and a full
 * stop carry the angle brackets on a US layout, which is as close to "back one, forward
 * one" as a key gets, and no browser or text box wants them with this modifier.
 */
const REORDER_TAB_SHORTCUT = byKey(',/.', 'shift')
/**
 * Not W. A bare Ctrl/Cmd+W is the browser's own close and cannot be taken from a page, and
 * the Alt that had to be added to dodge it made a three-finger chord for the commonest
 * thing in the panel — which macOS then rewrote into `∑` on the way.
 */
const CLOSE_TAB_SHORTCUT = byKey('X', 'shift')

/**
 * Drafts to store, grouped by the application they belong to. `applyStageNotes` allows one
 * draft per state in a call, so a panel holding two companies' notes cannot send one flat
 * list: the batches keep each application's stages apart.
 */
export interface StageNoteDraftBatch {
  applicationId: string
  drafts: StageNoteDraft[]
}

interface StageNotesPanelProps {
  /** Every application, so notes from any of them can be opened as a tab. */
  applications: Application[]
  /**
   * The arrangement to open with: what was restored from a previous sitting, or what the
   * view built for the note it was asked for. The panel takes it as given — where the
   * arrangement comes from is the view's business, not the panel's.
   */
  initial: Arrangement
  /**
   * A note to show, from a card or a table row. The nonce is what makes a second request
   * for the same note arrive as a second request rather than as no change at all.
   */
  request: NoteRequest | null
  /** Reports the arrangement after every change, so the view can remember it. */
  onArrange: (arrangement: Arrangement) => void
  /** The last tab just closed: there is nothing left for the panel to show. */
  onEmpty: () => void
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
 * document because the panel fills its view, so there is no one control to hang them off
 * and nothing else on screen that would otherwise name them.
 *
 * A disclosure holding a plain list, the same shape as the topbar's More actions: Escape
 * closes it, an outside pointer dismisses it, and focus returns to the trigger. Escape is
 * stopped here rather than left to bubble, as the find bar already does, so one key press
 * closes one thing.
 */
/*
 * In the order they are read and tabbed through, which the grid then places where they
 * point: above, left, right, below. Source order is what the keyboard follows, so it walks
 * the cross top to bottom rather than jumping around it.
 */
const SPLIT_CHOICES: readonly { edge: Edge; label: string; arrow: string; key: string }[] = [
  { edge: 'top', label: 'Above', arrow: '↑', key: 'ArrowUp' },
  { edge: 'left', label: 'Left', arrow: '←', key: 'ArrowLeft' },
  { edge: 'right', label: 'Right', arrow: '→', key: 'ArrowRight' },
  { edge: 'bottom', label: 'Below', arrow: '↓', key: 'ArrowDown' },
]

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
        // Handled on the way up from the trigger rather than from a document listener,
        // so it closes this disclosure and nothing else that happens to be listening.
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
        className="icon-button panel__chrome-button"
        onClick={() => setOpen(!open)}
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
              // Keyed by the label rather than the key: the two arrow bindings share `←/→`
              // and are told apart by the modifier they add to it.
              <div className="panel__shortcuts-row" key={shortcutLabel(shortcut)}>
                {/* The key names the row, so it is the term and the sentence is the
                    definition — which is also the order a reader scans them in. */}
                <dt>
                  <kbd className="panel__shortcut-key">{shortcutLabel(shortcut)}</kbd>
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

/**
 * Where the next pane goes.
 *
 * Split adds one, every time. It used to toggle — a second press gathered every pane back
 * into one — which put "take me back to a single pane" on the control a reader presses when
 * they want a third, at exactly the point they have two. Adding is what the control is for;
 * coming back is a thing to ask for by name, at the foot of this list.
 *
 * The directions are offered rather than assumed because there is no right default at three
 * panes: side by side is for reading two notes against each other, stacked is for following
 * one into another, and only the reader knows which they are doing.
 */
function SplitMenu({
  isSplit,
  open,
  setOpen,
  onSplit,
  onCollapse,
}: {
  isSplit: boolean
  /** Held by the panel, so `Ctrl/Cmd+\` opens the same menu this button does. */
  open: boolean
  setOpen: (open: boolean) => void
  onSplit: (edge: Edge) => void
  onCollapse: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstChoiceRef = useRef<HTMLButtonElement>(null)

  /*
   * Focus goes into the menu when it opens, which is what makes the arrows reachable from
   * the shortcut: opened from the keyboard, focus is still out in the panel, and a key
   * pressed there would never reach this.
   */
  useEffect(() => {
    if (open) firstChoiceRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, setOpen])

  const choose = (run: () => void) => {
    run()
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div
      className="panel__shortcuts"
      onKeyDown={(event) => {
        if (!open) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          triggerRef.current?.focus()
          return
        }
        /*
         * The arrows are the menu's own, and they are the whole point of it being a menu:
         * the direction a pane opens in is a direction, and an arrow is how a direction is
         * typed. Reached as a pair — the shortcut that opens this, then the arrow — rather
         * than as four global chords, because every arrow with a modifier already means
         * something here: Shift sends the tab being read to an edge, Alt walks it along
         * the strip.
         */
        const choice = SPLIT_CHOICES.find((entry) => entry.key === event.key)
        if (!choice || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
        event.preventDefault()
        event.stopPropagation()
        choose(() => onSplit(choice.edge))
      }}
      ref={containerRef}
    >
      <button
        aria-expanded={open}
        aria-keyshortcuts={shortcutKeys('\\')}
        aria-label="Split"
        className="icon-button panel__chrome-button"
        onClick={() => setOpen(!open)}
        ref={triggerRef}
        title={`Open another pane (${shortcutLabel('\\')}, then an arrow)`}
        type="button"
      >
        <Columns2 aria-hidden="true" size={16} />
      </button>
      {open ? (
        <div aria-labelledby="stage-notes-split-title" className="panel__shortcuts-panel" role="group">
          <p className="panel__shortcuts-title" id="stage-notes-split-title">
            Open another pane
          </p>
          <div className="panel__split-choices">
            {/* The pane being split, standing in the middle of the four so the choices
                around it read as sides of it rather than as a list of words. Decoration:
                each button already says where it opens, and a screen reader hearing
                "this pane" between them would be told the layout twice. */}
            <span aria-hidden="true" className="panel__split-here">This pane</span>
            {SPLIT_CHOICES.map(({ edge, label, arrow, key }) => (
              <button
                aria-keyshortcuts={key}
                className={`button button--quiet panel__split-choice panel__split-choice--${edge}`}
                key={edge}
                onClick={() => choose(() => onSplit(edge))}
                ref={edge === SPLIT_CHOICES[0].edge ? firstChoiceRef : undefined}
                type="button"
              >
                {label}
                {/* The key that does this, on the control that does it — the rule the title
                    bar keeps for every other shortcut in the panel. */}
                <span aria-hidden="true" className="panel__chrome-key">{arrow}</span>
              </button>
            ))}
          </div>
          {isSplit ? (
            <div className="panel__split-collapse">
              <button
                className="button button--quiet panel__split-choice panel__split-choice--collapse"
                onClick={() => choose(onCollapse)}
                type="button"
              >
                Collapse to one pane
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/**
 * A sidebar section's heading, which is also what folds it away. The control is inside the
 * thing it hides for once, and that works here because the heading stays: what goes is the
 * list under it, not the row that names it.
 */
function SidebarHeading({
  label,
  names,
  shown,
  onToggle,
}: {
  label: string
  /** What the button says it acts on, which is not always the heading with "the" in front
   *  of it: "Hide the all prep notes" is what that rule produces. */
  names: string
  shown: boolean
  onToggle: () => void
}) {
  return (
    <button
      aria-expanded={shown}
      aria-label={`${shown ? 'Hide' : 'Show'} ${names}`}
      className={`panel__sidebar-title${shown ? '' : ' panel__sidebar-title--folded'}`}
      onClick={onToggle}
      type="button"
    >
      <ChevronRight aria-hidden="true" size={12} />
      {label}
    </button>
  )
}

/** One external editing session, with the note it belongs to. */
interface OpenSession {
  ref: NoteRef
  session: StageNoteEditSession
}

export function StageNotesPanel({
  applications,
  initial,
  request,
  onArrange,
  onEmpty,
  onSaveDrafts,
  onExternalChange,
  onCapture,
  onRevise,
}: StageNotesPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

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
   * What tells two applications at the same company apart in the picker, where the stage
   * is not on the row at all: the role, grouped under the company rather than repeating
   * it on every row.
   */
  const applicationRole = useCallback((application: Application) => application.role?.trim() || 'No role', [])

  /**
   * Ids for the panes this sitting creates. A counter rather than a uuid: it is only ever
   * compared with its own siblings, and a readable id makes a layout easy to follow.
   */
  const paneCount = useRef(highestPaneNumber(initial.layout))
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
  const [layout, setLayout] = useState<LayoutNode>(initial.layout)
  const layoutRef = useRef(layout)
  const [focusedGroupId, setFocusedGroupId] = useState<string>(initial.focusedGroupId)
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
  /**
   * Notes whose capture dock is open. Collapsed by default and held here rather than in
   * the pane, so opening it for one note stays sticky across switching tabs away and back
   * — the pane for the tab left behind unmounts, but this does not.
   */
  const [captureOpen, setCaptureOpen] = useState<string[]>([])
  /**
   * Set by the "K" shortcut when it has to open a collapsed dock before it can focus the
   * box inside it: the box does not exist yet in the render that opens it, so focusing it
   * has to wait for the one after.
   */
  const [pendingCaptureFocusKey, setPendingCaptureFocusKey] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Record<string, OpenSession>>({})
  const sessionsRef = useRef(sessions)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  /**
   * Whether the sidebar is showing. One panel holding both things a reader navigates with
   * — the outline of the note in front of them, and every note behind it — stacked in one
   * column rather than switched between: having to choose which of the two you want is a
   * question the panel can answer for you by showing both. Closed leaves the rail, because
   * a control inside the thing it hides has nowhere to be once hidden.
   */
  const [sidebarOpen, setSidebarOpen] = useState(true)
  /**
   * Whether each half of the sidebar is showing. Held here rather than persisted, the way
   * the capture dock's own fold is: what a reader wants beside them changes with what they
   * are doing, and the heading that folds one away is always there to bring it back.
   */
  const [outlineShown, setOutlineShown] = useState(true)
  const [notesShown, setNotesShown] = useState(true)
  const [outlineShare, setOutlineShare] = useState(initial.outlineShare ?? DEFAULT_OUTLINE_SHARE)
  /** The column itself, so a drag can say what a pixel of it is worth as a share. */
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarOpenRef = useRef(sidebarOpen)
  useEffect(() => {
    sidebarOpenRef.current = sidebarOpen
  }, [sidebarOpen])

  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), [])

  /**
   * How the two halves of the sidebar share it. A share rather than a height, so what one
   * half gives up the other takes, and so the handle sits in the same place in a window of
   * any height. A drag arrives in pixels and is divided by the column it moved across.
   */
  const resizeOutline = useCallback((delta: number) => {
    setOutlineShare((current) => outlineShareWithin(current + delta))
  }, [])

  const dragOutline = useCallback((pixels: number) => {
    const column = sidebarRef.current?.getBoundingClientRect().height ?? 0
    if (column <= 0) return
    resizeOutline(pixels / column)
  }, [resizeOutline])

  const endOutlineDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => endOutlineDrag.current?.(), [])

  const beginOutlineDrag = useCallback(
    (startY: number) => {
      let from = startY
      const move = (event: MouseEvent) => {
        dragOutline(event.clientY - from)
        from = event.clientY
      }
      const stop = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', stop)
        endOutlineDrag.current = null
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', stop)
      endOutlineDrag.current = stop
    },
    [dragOutline],
  )
  // Find state. `findSeq` remounts the widget so a second Ctrl+F refocuses and selects
  // the query already in it, the way reopening find in an editor does.
  const [findOpen, setFindOpen] = useState(false)
  const [findSeq, setFindSeq] = useState(0)
  const [findQuery, setFindQuery] = useState('')
  const [matchCursor, setMatchCursor] = useState(0)
  /**
   * The pane the picker was opened from, or null when it is closed. A pane rather than a
   * flag because the + that opens it sits in a pane's own tab strip: what it opens belongs
   * beside the tabs it was pressed among, not in whichever pane happened to be read last.
   */
  /**
   * How tall the captured lines are, in every pane at once. One height rather than one per
   * note: dragging the dock open for an interview is the reader sizing their workspace,
   * and a height that reset with every tab switch would have to be dragged again each
   * time. Undefined until one is dragged, which leaves the stylesheet its own default.
   */
  const [captureHeight, setCaptureHeight] = useState(initial.captureHeight ?? DEFAULT_CAPTURE_LOG)
  const [sidebarWidth, setSidebarWidth] = useState(initial.sidebarWidth ?? DEFAULT_SIDEBAR)
  const sidebarWidthRef = useRef(sidebarWidth)
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth
  }, [sidebarWidth])
  const [splitMenuOpen, setSplitMenuOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState<string | null>(null)
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

  const emptyRef = useRef(onEmpty)
  useEffect(() => {
    emptyRef.current = onEmpty
  }, [onEmpty])

  const arrangeRef = useRef(onArrange)
  useEffect(() => {
    arrangeRef.current = onArrange
  }, [onArrange])

  /**
   * Replaces the arrangement. Null means the last note just closed, which leaves the view
   * holding the panel with nothing to show — its cue to offer the empty state instead.
   */
  const applyLayout = useCallback((next: LayoutNode | null, focusGroupId?: string) => {
    if (!next) {
      emptyRef.current()
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
   * The same notes as the copies they are. A note open in two panes is two places on
   * screen, and anything numbering or addressing what is showing has to say which.
   */
  const openTabs = useMemo(() => orderedTabs(layout), [layout])

  /**
   * What each tab says, worked out over every tab in the panel rather than strip by strip.
   * A pane is not an island: two panes holding one company each would both find nothing to
   * tell their tabs from their neighbours and both drop the company, leaving "Interview 2"
   * beside "Offer" with nothing on screen saying whose. What a tab competes with is
   * everything else open, wherever it is.
   */
  const shortLabels = useMemo(() => {
    const labels = tabLabels(
      openTabs.map(({ ref }) => {
        const application = applicationsById.get(ref.applicationId)
        return {
          company: application?.company ?? '',
          role: application ? applicationRole(application) : '',
          stage: stateLabel(ref.state),
        }
      }),
    )
    // Keyed by the copy rather than by the note: one note open in two panes is two tabs,
    // and each pane looks its own up.
    return new Map(openTabs.map(({ groupId, ref }, index) => [tabId(groupId, ref), labels[index]]))
  }, [applicationRole, applicationsById, openTabs])

  /**
   * Which tab each pane is showing, as one string, so the effect below runs when a strip
   * changes what it is showing rather than on every arrangement of anything.
   */
  const showing = useMemo(
    () => groupsOf(layout).map((group) => `${group.id}@${group.activeKey ?? ''}`).join('|'),
    [layout],
  )

  /*
   * A strip scrolls, and a tab opened onto the end of one lands past its edge — the note
   * appears below while the tab that says which note it is does not. So the tab a pane has
   * just shown is brought into view in its own strip.
   *
   * `nearest` on both axes so a tab already showing is left where it is and the panel
   * around it is not scrolled: this moves a strip, and only as far as it has to.
   */
  useEffect(() => {
    for (const group of groupsOf(layoutRef.current)) {
      const ref = group.tabs.find((tab) => noteRefKey(tab) === group.activeKey)
      if (!ref) continue
      // Optional call: jsdom has no layout and leaves scrollIntoView undefined.
      tabRefs.current[tabId(group.id, ref)]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }
  }, [showing])

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
  /*
   * The pane the chrome describes. Normally the focused one, but a pane can be open and
   * empty — the outline, the breadcrumbs and the status bar are about a note, so they
   * follow the nearest pane holding one rather than going blank. Focus itself stays where
   * it is, which is what makes an opened note land in the empty pane.
   */
  const activeGroup = groups.find((group) => group.id === focusedGroupId && group.tabs.length > 0)
    ?? groups.find((group) => group.tabs.length > 0)
    ?? groups[0]
  const activeRef =
    activeGroup.tabs.find((tab) => noteRefKey(tab) === activeGroup.activeKey) ?? activeGroup.tabs[0]
  const activeKey = noteRefKey(activeRef)
  /** Every note the panel has open, for the tree beside it to mark as already there. */
  const openKeys = useMemo(
    () => new Set(orderedRefs(layout).map(noteRefKey)),
    [layout],
  )
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
    /**
     * `tabs` defaults to what is open now, and is passed in by a caller numbering the
     * matches of an arrangement it is about to apply — a note being opened is not in
     * `openTabs` until the render after, and its matches have to be found before then.
     */
    (value: string, tabs: { groupId: string; ref: NoteRef }[] = openTabs) => {
      const perTab = new Map<
        string,
        { base: number; count: number; written: number; inEditor: boolean; key: string }
      >()
      const order: string[] = []
      let total = 0
      if (!value.trim()) return { perTab, order, total }

      const countIn = (source: string) =>
        source.trim() ? searchNote(buildSections(parseMarkdown(source)), value).count : 0

      for (const { groupId, ref } of tabs) {
        // Two ids in play, and the difference is the point: the note's key says what the
        // text is, and is shared by every copy of it, while the tab's says which copy is
        // being numbered. Matches belong to a copy; drafts belong to a note.
        const id = tabId(groupId, ref)
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
        perTab.set(id, { base: total, count, written, inEditor, key })
        order.push(id)
        total += count
      }
      return { perTab, order, total }
    },
    [capturedByKey, drafts, editing, editingLines, openTabs, sessions],
  )

  const matches = useMemo(() => findMatches(query), [findMatches, query])

  // The cursor runs unbounded so Next and Previous can wrap; this is where it lands.
  const currentMatch = matches.total === 0
    ? null
    : ((matchCursor % matches.total) + matches.total) % matches.total

  /** The copy holding a given position in the panel-wide list of matches. */
  const noteOfMatch = (position: number): string | undefined =>
    matches.order.find((id) => {
      const found = matches.perTab.get(id)
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
    /**
     * `intoGroupId` names the pane to open into, for a caller that belongs to one — the +
     * in a pane's tab strip. Without it the note goes to the pane being read, which is
     * what a request from outside the panel and the keyboard shortcut both want.
     */
    (ref: NoteRef, intoGroupId?: string) => {
      const wanted = intoGroupId ?? focusedGroupId
      const target = groupsOf(layoutRef.current).find((group) => group.id === wanted)
        ?? groupsOf(layoutRef.current)[0]
      // Into this pane, whatever any other pane is showing. `openInGroup` settles the rest:
      // a pane already holding the note just shows it, and one that is not gets a copy.
      // Reaching for a note is a request to have it here, not a request to be sent to
      // wherever a copy of it happens to be.
      applyLayout(openInGroup(layoutRef.current, target.id, ref), target.id)
    },
    [applyLayout, focusedGroupId],
  )

  /**
   * What the stage-switch dropdown on a pane picks: swaps the tab it sits on for the
   * stage chosen, in that tab's own place — "show me this stage instead" rather than
   * "also open this one". A stage already open elsewhere is focused there instead of
   * opening a second copy of it, closing the tab it was swapped out from.
   */
  const switchStage = useCallback(
    (groupId: string, fromKey: string, ref: NoteRef) => {
      const next = replaceTab(layoutRef.current, groupId, fromKey, ref)
      // Not necessarily `groupId` any more: swapping onto a stage already open elsewhere
      // closes this pane's own tab and focuses that one instead, which can take the pane
      // itself with it if that tab was the only one here.
      const target = groupHolding(next, noteRefKey(ref))?.id ?? groupId
      applyLayout(next, target)
    },
    [applyLayout],
  )

  /*
   * The arrangement reported out after every change, so the view holding the panel can
   * remember it. Through a ref because the view re-renders on every write the notes make:
   * depending on the callback itself would restart this on writes that did not move a
   * tab.
   */
  useEffect(() => {
    arrangeRef.current({ layout, focusedGroupId, captureHeight, sidebarWidth, outlineShare })
  }, [captureHeight, focusedGroupId, layout, outlineShare, sidebarWidth])

  /*
   * A note asked for from outside the panel. Only the nonce is watched: the ref alone
   * cannot tell a second ask for the note already on show from no ask at all, and the
   * request prop stays put between them.
   */
  const handledNonce = useRef(request?.nonce ?? null)
  useEffect(() => {
    if (!request || request.nonce === handledNonce.current) return
    handledNonce.current = request.nonce
    showRef(request.ref)
    panelRef.current?.focus()
  }, [request, showRef])

  /**
   * Moves the dock's edge. The pane hands over how far to move, not where to land: one
   * height is shared by every pane, so where it lands is the panel's to decide.
   *
   * The floor stops the drag rather than closing the dock — the toggle above it is the way
   * to put the log away, and one control per outcome is the rule this panel keeps.
   */
  const resizeCapture = useCallback((delta: number) => {
    setCaptureHeight((current) => captureHeightWithin(current + delta))
  }, [])

  const endSidebarDrag = useRef<(() => void) | null>(null)
  // A drag outlives a re-render, but must not outlive the panel it belongs to.
  useEffect(() => () => endSidebarDrag.current?.(), [])

  /**
   * Puts the sidebar's edge at a width. Below what its own rows can be read at it closes
   * rather than narrowing further — a column too thin to read is not a narrower sidebar,
   * it is a sidebar in the way — and at or above it the sidebar opens, whether or not it
   * was open a moment ago. The edge works both ways because a width is something to drag
   * *to*, not only away from, and what comes back is the panel that went.
   */
  const sidebarTo = useCallback((width: number) => {
    if (width < MIN_SIDEBAR) {
      setSidebarOpen(false)
      return
    }
    setSidebarOpen(true)
    setSidebarWidth(sidebarWidthWithin(width))
  }, [])

  /**
   * The arrow keys, which move by a step rather than to a place. Closed, the only step
   * that means anything is the one that opens it, and it comes back at the width it had:
   * stepping out from nothing would take a dozen presses to reach a readable column.
   */
  const resizeSidebar = useCallback(
    (delta: number) => {
      if (!sidebarOpenRef.current) {
        if (delta > 0) setSidebarOpen(true)
        return
      }
      sidebarTo(sidebarWidthRef.current + delta)
    },
    [sidebarTo],
  )

  /**
   * The drag that moves it, re-based on every move so the edge tracks the pointer rather
   * than accelerating away from it — the same reason the other handles re-base theirs.
   */
  const beginSidebarDrag = useCallback((railRight: number) => {
    const move = (event: MouseEvent) => {
      // Measured from where the sidebar starts rather than accumulated from where the drag
      // did: a closed sidebar has no width to add to, and a pointer at a place says the
      // whole of what the reader means by it.
      sidebarTo(event.clientX - railRight)
    }
    const stop = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
      endSidebarDrag.current = null
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
    endSidebarDrag.current = stop
  }, [sidebarTo])

  /**
   * Closes the note on show in the pane being read. Off the refs rather than the rendered
   * values, so the document listener that calls it is not rebound every time a tab changes.
   */
  const closeFocusedTab = useCallback(() => {
    const groups = groupsOf(layoutRef.current)
    const group = groups.find((entry) => entry.id === focusedGroupRef.current) ?? groups[0]
    if (!group?.activeKey) return
    applyLayout(closeTab(layoutRef.current, group.id, group.activeKey))
  }, [applyLayout])

  /**
   * Shows one copy: the tab in the pane the id names. The find steps between copies as
   * well as between notes, so it has to say which — `showKey` would land on whichever
   * pane happened to hold the note first.
   */
  const showTab = useCallback(
    (id: string) => {
      const found = parseTabId(id)
      if (!found) return
      applyLayout(activateTab(layoutRef.current, found.groupId, noteRefKey(found.ref)), found.groupId)
    },
    [applyLayout],
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
  const revealInSource = (id: string | undefined, position: number) => {
    const found = id ? matches.perTab.get(id) : undefined
    if (!id || !found?.inEditor) return
    const key = found.key
    const index = position - found.base
    // Past the written note is the captured log, which renders marks like any note.
    if (index >= found.written) return
    const at = matchOffsets(drafts[key] ?? '', query)[index]
    if (at === undefined) return

    requestAnimationFrame(() => {
      const pane = notesRef.current
      const box = pane?.querySelector<HTMLTextAreaElement>(`[data-note-source="${id}"]`)
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
    const id = noteOfMatch(landing)
    if (id) showTab(id)
    revealInSource(id, landing)
  }

  /** A new query starts from its first match, in whichever note that turns out to be. */
  const changeQuery = (value: string) => {
    setFindQuery(value)
    setMatchCursor(0)
    const [first] = findMatches(value).order
    if (first) showTab(first)
  }

  /**
   * A hit picked in the notes tree: open the note here, then hand the words to the panel's
   * own find. Everything that makes a match legible — the highlight, the fold opened to
   * show one, the count in the find bar, the step to the next — already lives there, and a
   * second way of showing the same thing would be a second thing to keep right.
   *
   * The cursor is worked out against the arrangement being applied rather than the one on
   * screen: the note is being opened now, so it is not among the open tabs until the render
   * after this, and its matches would be numbered from a panel it is not yet in.
   */
  const findInNote = useCallback(
    (ref: NoteRef, query: string) => {
      if (!query) return
      const groups = groupsOf(layoutRef.current)
      const target = groups.find((group) => group.id === focusedGroupRef.current) ?? groups[0]
      const next = openInGroup(layoutRef.current, target.id, ref)
      applyLayout(next, target.id)
      setFindQuery(query)
      setFindOpen(true)
      setFindSeq((current) => current + 1)

      // Its first match rather than the snippet's own position: the tree counts hits in the
      // note read as prose and the find counts them in the note as written, and the two
      // need not agree. Landing in the right note with the find running is the promise;
      // stepping from there is what the find bar is for.
      const found = findMatches(query, orderedTabs(next)).perTab.get(tabId(target.id, ref))
      setMatchCursor(found ? found.base : 0)
    },
    [applyLayout, findMatches],
  )

  const closeFind = () => {
    setFindOpen(false)
    setFindQuery('')
    panelRef.current?.focus()
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
  /**
   * Opens another pane, always — the pane being read keeps the note it is showing, and one
   * of its other tabs moves into the new one. Taken out rather than copied: a split shows
   * two notes at once, and a second copy of the same note is not what was asked for.
   * Opening one twice is a drag, which says so.
   */
  /**
   * Opens a pane, empty. Nothing is moved into it and nothing is copied: what the reader
   * asked for is room, and which note goes in it is the next thing they say — from the
   * picker, from the tree, or by dragging a tab across. A pane that arrived holding a note
   * chosen for it was a guess, and half the time the guess had to be undone first.
   *
   * Focus goes with it, so the note opened next lands where the room was made.
   */
  const splitOff = useCallback((edge: Edge) => {
    const current = layoutRef.current
    const list = groupsOf(current)
    const from = list.find((group) => group.id === focusedGroupRef.current) ?? list[0]
    const before = new Set(list.map((group) => group.id))
    const split = splitEmpty(current, from.id, edge, newId)
    const fresh = groupsOf(split).find((group) => !before.has(group.id))
    applyLayout(split, fresh?.id ?? from.id)
  }, [applyLayout, newId])

  /** Every pane back into one, which Split used to do on a second press. */
  const collapseSplit = useCallback(() => {
    const list = groupsOf(layoutRef.current)
    const first = list[0]
    // One strip cannot hold a note twice, so copies gathered from several panes collapse
    // back into the one tab they are copies of.
    const gathered: NoteRef[] = []
    for (const tab of list.flatMap((group) => group.tabs)) {
      if (!gathered.some((kept) => noteRefKey(kept) === noteRefKey(tab))) gathered.push(tab)
    }
    applyLayout(makeGroup(first.id, gathered, first.activeKey), first.id)
  }, [applyLayout])

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
   * What a drag is carrying, and where it came from.
   *
   * A tab hands over its own id — the pane it is in and the note it shows — because
   * dragging a tab means moving that copy out of that pane. A row in the tree of unopened
   * notes hands over a note key, which names no pane, because dragging one means opening a
   * copy where it lands and leaving every other copy alone. The two intents differ and the
   * payload is what tells them apart.
   */
  const dragged = useCallback(
    (key: string): { ref: NoteRef; from: string | null } | null => {
      const asTab = parseTabId(key)
      if (asTab) return { ref: asTab.ref, from: asTab.groupId }
      const ref = refByKey.get(key) ?? parseNoteRefKey(key)
      return ref ? { ref, from: null } : null
    },
    [refByKey],
  )

  /**
   * Lands a dragged or arrowed tab in a pane. The keyboard and the pointer share this so
   * the two cannot drift: whatever a drag can arrange, the arrows can arrange too, which
   * is the whole reason the layout operations are pure.
   */
  const dropTab = useCallback(
    (key: string, groupId: string, index: number) => {
      const held = dragged(key)
      if (!held) return
      const next = held.from
        ? moveTab(layoutRef.current, held.from, noteRefKey(held.ref), groupId, index)
        : placeTab(layoutRef.current, held.ref, groupId, index)
      applyLayout(next, groupId)
    },
    [applyLayout, dragged],
  )

  /** Opens a new pane on one side of an existing one, holding the note that was dragged. */
  const splitTabOff = useCallback(
    (key: string, targetGroupId: string, edge: Edge) => {
      const held = dragged(key)
      if (!held) return
      applyLayout(splitWith(layoutRef.current, targetGroupId, edge, held.ref, newId, held.from))
    },
    [applyLayout, dragged, newId],
  )

  /**
   * Sends the tab being read towards one edge: into the pane already over there, or into a
   * new one when there is none. One binding for both because they are the same intent —
   * put this note over there — and asking the reader to know which case they are in first
   * would be asking them to hold the shape of the tree in their head.
   */
  const moveTabToEdge = useCallback(
    (edge: Edge) => {
      const tree = layoutRef.current
      const from = groupsOf(tree).find((group) => group.id === focusedGroupRef.current)
        ?? groupsOf(tree)[0]
      const key = from.activeKey
      const ref = key ? from.tabs.find((tab) => noteRefKey(tab) === key) : undefined
      if (!key || !ref) return

      const neighbour = neighbourGroup(tree, from.id, edge)
      if (neighbour) {
        const target = groupsOf(tree).find((group) => group.id === neighbour)!
        // Landing nearest the edge it came from, so the tab arrives where it was aimed.
        dropTab(tabId(from.id, ref), neighbour, edge === 'right' || edge === 'bottom' ? 0 : target.tabs.length)
        return
      }
      splitTabOff(tabId(from.id, ref), from.id, edge)
    },
    [dropTab, splitTabOff],
  )

  /**
   * Dragging a tab with a pointer of any kind, mouse or finger. Display state that lasts
   * one gesture and describes nothing about the notes. Both landings go to the same places
   * the arrow keys do, so a drag can reach no arrangement the keyboard cannot.
   */
  const drag = useTabDrag({
    onDropInSlot: (key, groupId, index) => dropTab(key, groupId, index),
    onDropOnEdge: (key, groupId, edge) => splitTabOff(key, groupId, edge),
  })

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
        // Opens the menu and lands in it, where an arrow says which way. A pane opens in a
        // direction, and the four directions cannot each have a chord of their own: every
        // arrow with a modifier is already spoken for here — Shift sends the tab being
        // read to an edge, Alt walks it along the strip.
        setSplitMenuOpen(true)
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
        // The shortcut has no strip of its own, so it opens into the pane being read. Read
        // from the ref so this listener is not rebound every time focus moves between
        // panes, the same reason the capture shortcut finds its box in the DOM.
        setQuickOpen(focusedGroupRef.current)
        return
      }
      if (key === 'b') {
        event.preventDefault()
        toggleSidebar()
        return
      }
      /*
       * X rather than W, and Shift rather than Alt. `Ctrl/Cmd+W` is the browser's own close
       * and a page in a tab cannot take it, so this had carried Alt to dodge it — and Alt
       * is a layout modifier on macOS, which rewrote the key into `∑` on the way and took
       * two more lines of matching to read back. Shift changes no character, so the key is
       * the key, and closing the note you are reading is a two-finger chord again.
       */
      if (key === 'x') {
        if (!event.shiftKey || event.altKey) return
        event.preventDefault()
        closeFocusedTab()
        return
      }
      /*
       * Both readings again, for the reason the old W binding needed them: Shift is a
       * layout modifier over punctuation, so these arrive as `<` and `>` on a US layout
       * and as something else again elsewhere, while `code` keeps naming the key cap. The
       * characters are matched as well, since a layout that puts a comma somewhere else
       * reports that key's own code.
       */
      const earlier = event.code === 'Comma' || key === ',' || key === '<'
      const later = event.code === 'Period' || key === '.' || key === '>'
      if (earlier || later) {
        if (!event.shiftKey || event.altKey) return
        event.preventDefault()
        reorderActiveTab(later ? 1 : -1)
        return
      }
      if (key === 'k') {
        event.preventDefault()
        // Opens the dock first if it is collapsed, the same shortcut either way: reaching
        // for it should not depend on remembering whether it was left open last time.
        setCaptureOpen((current) => (current.includes(activeKey) ? current : [...current, activeKey]))
        setPendingCaptureFocusKey(activeKey)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [activeKey, closeFocusedTab, openFind, reorderActiveTab, toggleSidebar])

  /**
   * Focuses the capture box once the dock the "K" shortcut just opened has actually
   * rendered it. Found in the DOM rather than by index, so this does not have to be
   * rebound every time the focus moves from one pane to the other.
   */
  useEffect(() => {
    if (!pendingCaptureFocusKey) return
    const target = notesRef.current?.querySelector<HTMLTextAreaElement>('[data-capture-focus]')
    if (!target) return
    target.focus()
    setPendingCaptureFocusKey(null)
  }, [captureOpen, pendingCaptureFocusKey])

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
      const edges: Record<string, Edge> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'top',
        ArrowDown: 'bottom',
      }
      const edge = edges[event.key]
      if (!edge) return
      if (!event.shiftKey || event.altKey) return
      /*
       * Not while something is being typed into. In a text box `⌘⇧←` selects to the start
       * of the line, and a note being written is the one place in this panel where that is
       * what the reader means — taking it there cost them the selection and moved a tab
       * they were not thinking about.
       */
      if (isTyping(event.target)) return
      event.preventDefault()
      moveTabToEdge(edge)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [moveTabToEdge, reorderActiveTab])

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

  /**
   * One row per application rather than one per stage: the stage is what the dropdown on
   * that row is for, so the list the fuzzy search runs over stays the length of the
   * applications instead of the length of every stage any of them could reach.
   */
  /** The pane the picker was opened from, whose tabs decide what reads as already open. */
  const pickingInto = useMemo(
    () => (quickOpen ? groupsOf(layout).find((group) => group.id === quickOpen) ?? null : null),
    [layout, quickOpen],
  )

  const quickOpenEntries: QuickOpenEntry[] = useMemo(() => {
    const byApplication = new Map<string, { application: Application; refs: NoteRef[] }>()
    for (const { ref } of pickable.values()) {
      const application = applicationsById.get(ref.applicationId)
      if (!application) continue
      const group = byApplication.get(application.id) ?? { application, refs: [] }
      group.refs.push(ref)
      byApplication.set(application.id, group)
    }
    return [...byApplication.values()].map(({ application, refs }) => {
      const ordered = [...refs].sort((left, right) => stateRank(left.state) - stateRank(right.state))
      return {
        id: application.id,
        company: application.company,
        role: applicationRole(application),
        stages: ordered.map((ref) => ({
          id: noteRefKey(ref),
          label: stateLabel(ref.state),
          // Open **here**, in the pane this picker belongs to, rather than open anywhere:
          // that is what decides whether picking it shows a tab you have or adds one, and
          // a badge saying Open over a note this pane has not got would be describing
          // somewhere else.
          open: pickingInto?.tabs.some((tab) => noteRefKey(tab) === noteRefKey(ref)) ?? false,
        })),
        defaultStageId: noteRefKey({ applicationId: application.id, state: application.state }),
      }
    })
  }, [applicationRole, applicationsById, pickable, pickingInto])

  const openFromPicker = (key: string) => {
    const ref = pickable.get(key)?.ref
    if (ref) showRef(ref, quickOpen ?? undefined)
    setQuickOpen(null)
    panelRef.current?.focus()
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

    /*
     * A pane opened empty: room made for the next note rather than a note moved into it.
     * Its strip is still here, empty, because it is a drop place — a tab dragged onto it
     * is one of the ways a note gets here — and because a pane with no strip at all would
     * read as a hole in the panel rather than as a pane.
     */
    if (!shown) {
      return (
        <div className="panel__group" key={group.id}>
          <div
            aria-describedby={TABS_HINT_ID}
            aria-label={`Prep note tabs, pane ${paneNumber}`}
            className="panel__tabs"
            role="tablist"
            {...{ [DROP_SLOT_GROUP]: group.id, [DROP_SLOT_INDEX]: 0 }}
          />
          <div className="panel__empty-pane">
            <p>This pane is empty.</p>
            <button
              className="button button--quiet"
              onClick={() => {
                setFocusedGroupId(group.id)
                setQuickOpen(group.id)
              }}
              type="button"
            >
              <Plus aria-hidden="true" size={16} />
              Open a note
              <span aria-hidden="true" className="panel__chrome-key">{shortcutLabel('P')}</span>
            </button>
            <p className="panel__empty-pane-hint">Or drag one here from the sidebar.</p>
            <button
              aria-label={`Close pane ${paneNumber}`}
              className="button button--quiet panel__empty-pane-close"
              onClick={() => applyLayout(closeGroup(layoutRef.current, group.id))}
              type="button"
            >
              Close this pane
            </button>
          </div>
        </div>
      )
    }

    const shownKey = noteRefKey(shown)
    const open = sessions[shownKey]
    const found = matches.perTab.get(tabId(group.id, shown))
    const isFocusedGroup = group.id === activeGroup.id
    const shownApplication = applicationsById.get(shown.applicationId)

    return (
      <div className="panel__group" key={group.id}>
        <div
          aria-describedby={TABS_HINT_ID}
          aria-label={`Prep note tabs, pane ${paneNumber}`}
          className="panel__tabs"
          role="tablist"
          // The strip itself is the last drop place, so a tab let go on the bare end of it
          // joins the end. A slot is a nearer ancestor of its own tab, so a drop over one
          // still finds the slot rather than this.
          {...{ [DROP_SLOT_GROUP]: group.id, [DROP_SLOT_INDEX]: group.tabs.length }}
        >
          {group.tabs.map((tab, tabIndex) => {
            const key = noteRefKey(tab)
            const label = labelOf(tab)
            const shortLabel = shortLabels.get(tabId(group.id, tab)) ?? label
            const tabMatches = matches.perTab.get(tabId(group.id, tab))
            const isActive = key === shownKey
            const application = applicationsById.get(tab.applicationId)
            // The whole name, for the tooltip and for anyone reading the strip through its
            // accessible names rather than looking at it.
            const fullLabel = application
              ? `${application.company} · ${applicationRole(application)} · ${stateLabel(tab.state)}`
              : label
            const isDropTarget =
              drag.target?.kind === 'slot'
              && drag.target.groupId === group.id
              && drag.target.index === tabIndex
            return (
              // Presentational, so the tablist still owns the tabs themselves: a close
              // control cannot sit inside a button, and it belongs beside its own tab.
              // It is also the drop place, named by attributes rather than by handlers:
              // a captured pointer sends no enter or leave events, so the drag finds where
              // it is over by hit-testing the document instead.
              <div
                className={[
                  'panel__tab-slot',
                  drag.key === tabId(group.id, tab) ? 'panel__tab-slot--dragging' : '',
                  isDropTarget ? 'panel__tab-slot--drop-target' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={key}
                role="presentation"
                {...{ [DROP_SLOT_GROUP]: group.id, [DROP_SLOT_INDEX]: tabIndex }}
              >
                <button
                  aria-controls={isActive ? stageNotePanelId(group.id, tab) : undefined}
                  aria-keyshortcuts={`${shortcutKeys(MOVE_TAB_SHORTCUT)} ${shortcutKeys(REORDER_TAB_SHORTCUT)}`}
                  aria-selected={isActive}
                  className={[
                    'panel__tab',
                    isActive ? 'panel__tab--open panel__tab--active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  id={stageTabId(group.id, tab)}
                  onClick={() => {
                    // The browser sends a click after any pointer sequence, this one
                    // included. Dropping a tab somewhere is not also a request to read it.
                    if (drag.wasDragged()) return
                    applyLayout(activateTab(layoutRef.current, group.id, key), group.id)
                  }}
                  // Its own id, not the note's: dragging a tab moves this copy out of
                  // this pane, where dragging a row in the tree opens another one.
                  onPointerDown={(event) => drag.start(event, tabId(group.id, tab))}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                    /*
                     * The bare arrows only. The same arrows with a modifier belong to the
                     * panel — Ctrl/Cmd+Shift sends this tab to an edge, Alt walks it along
                     * the strip — and stepping the selection here as well meant the chord
                     * moved whichever tab the step had just landed on rather than the one
                     * the reader was looking at.
                     */
                    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
                    event.preventDefault()
                    const step = event.key === 'ArrowRight' ? 1 : -1
                    const index = group.tabs.findIndex((entry) => noteRefKey(entry) === key)
                    const next = group.tabs[(index + step + group.tabs.length) % group.tabs.length]
                    const nextKey = noteRefKey(next)
                    applyLayout(activateTab(layoutRef.current, group.id, nextKey), group.id)
                    // Focus follows the selection, or the next arrow key would be read
                    // by the tab left behind and step from the wrong place.
                    tabRefs.current[tabId(group.id, next)]?.focus()
                  }}
                  ref={(node) => {
                    tabRefs.current[tabId(group.id, tab)] = node
                  }}
                  role="tab"
                  tabIndex={isActive ? 0 : -1}
                  type="button"
                  title={fullLabel}
                >
                  {/* The whole name to a screen reader, the distinguishing part of it on
                      screen: a strip is read one tab at a time, where it is looked at all
                      at once, so what a reader needs is not what a listener does. */}
                  <span className="sr-only">{fullLabel}</span>
                  <span aria-hidden="true" className="panel__tab-label">{shortLabel}</span>
                  {application?.state === tab.state ? (
                    <span className="panel__tab-badge">Current</span>
                  ) : null}
                  {tabMatches ? <span className="panel__tab-count">{tabMatches.count}</span> : null}
                </button>
                <button
                  // The binding is named on the control that does the same thing, the way
                  // Split and Find name theirs: a shortcut nothing on screen names is one
                  // only the README has.
                  aria-keyshortcuts={shortcutKeys(CLOSE_TAB_SHORTCUT)}
                  aria-label={`Close the ${label} tab`}
                  className="icon-button panel__tab-close"
                  onClick={() => closeNote(group.id, key)}
                  title={`Close the ${label} tab (${shortcutLabel(CLOSE_TAB_SHORTCUT)}). Its notes are kept.`}
                  type="button"
                >
                  <X aria-hidden="true" size={12} />
                </button>
              </div>
            )
          })}
        </div>

        {/*
          Where a dragged tab can land in this pane. Real elements per edge rather than a
          reading of the pointer's position against the pane's box: the browser does the
          hit-testing it is already good at, the zones can be styled and highlighted on
          their own, and nothing here has to measure a layout that does not exist until it
          has rendered. Only up during a drag, and hidden from assistive technology —
          there is nothing here to operate without a pointer, and the arrows do the same
          job for anyone who has not got one.
        */}
        <div className="panel__group-body">
        {drag.key ? (
          <div aria-hidden="true" className="panel__dropzones">
            {(['left', 'right', 'top', 'bottom'] as const).map((edge) => (
              <div
                className={[
                  'panel__dropzone',
                  `panel__dropzone--${edge}`,
                  drag.target?.kind === 'edge'
                  && drag.target.groupId === group.id
                  && drag.target.edge === edge
                    ? 'panel__dropzone--over'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={edge}
                {...{ [DROP_EDGE]: edge, [DROP_EDGE_PANE]: group.id }}
              />
            ))}
          </div>
        ) : null}

        <StageNotePane
          body={drafts[shownKey] ?? ''}
          captured={capturedByKey.get(shownKey) ?? ''}
          company={shownApplication?.company ?? ''}
          currentMatch={currentMatch}
          formatDate={formatShortDate}
          groupId={group.id}
          heardMatchBase={(found?.base ?? 0) + (found?.written ?? 0)}
          isCurrentState={shownApplication?.state === shown.state}
          captureHeight={captureHeight}
          isCaptureOpen={captureOpen.includes(shownKey)}
          onResizeCapture={resizeCapture}
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
          onSwitchStage={(state) =>
            switchStage(group.id, shownKey, { applicationId: shown.applicationId, state })}
          onToggleCapture={() =>
            setCaptureOpen((current) =>
              current.includes(shownKey)
                ? current.filter((entry) => entry !== shownKey)
                : [...current, shownKey],
            )}
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
          role={shownApplication ? applicationRole(shownApplication) : 'No role'}
          saved={noteByKey.get(shownKey)}
          session={open?.session}
        />
        </div>
      </div>
    )
  }

  return (
    /*
     * Focusable, but not a tab stop: the panel is where focus lands after the find bar or
     * the picker closes, and after a note is opened into it from another view.
     */
    <div
      className="panel"
      ref={panelRef}
      /* Set on the panel rather than on each dock: the height is shared, and one variable
         is what makes every pane agree without passing it down twice. */
      style={{
        '--capture-log': `${captureHeight}px`,
        '--sidebar': `${sidebarWidth}px`,
      } as CSSProperties}
      tabIndex={-1}
    >
        <div className="panel__titlebar">
          {/*
            * At the left end, over the column it opens and closes. It had been filed with
            * the controls on the right, where it acts at a distance on the far side of the
            * panel: a switch belongs by the thing it switches, and this one is pointing at
            * the edge it lives on.
            */}
          <button
            aria-keyshortcuts={shortcutKeys('B')}
            aria-label="Sidebar"
            aria-pressed={sidebarOpen}
            className="icon-button panel__chrome-button panel__chrome-button--sidebar"
            onClick={toggleSidebar}
            title={`${sidebarOpen ? 'Hide' : 'Show'} the sidebar (${shortcutLabel('B')})`}
            type="button"
          >
            <PanelLeft aria-hidden="true" size={16} />
          </button>
          {/* The view is already named by the tab that reached it and by the heading over
              it, so the title bar carries only what the panel itself is showing. */}
          <p className="panel__subject">{title}</p>
          {/*
            * Icons alone, each naming itself on hover and to a screen reader. Labels here
            * spent more of the title bar on saying what these are than on the note the bar
            * belongs to, and they are reached rarely enough that carrying their names all
            * the time was the wrong trade.
            *
            * Open keeps its own. It is the way to a note that is not open yet — the thing a
            * reader reaches for who has not got what they want on screen — and it is the
            * only visible place `Ctrl`/`Cmd+P` is written down.
            */}
          <button
            aria-keyshortcuts={shortcutKeys('P')}
            // Named for the word on it, not the word plus the key beside it: the binding is
            // `aria-keyshortcuts`' to announce, and a name that reads "Open ⌘P" is a name
            // nobody would say out loud to ask for this button.
            aria-label="Open"
            className="button button--quiet panel__chrome-button panel__chrome-button--labelled"
            onClick={() => setQuickOpen(focusedGroupId)}
            title={`Open a note or a stage (${shortcutLabel('P')})`}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            Open
            <span aria-hidden="true" className="panel__chrome-key">{shortcutLabel('P')}</span>
          </button>
          <SplitMenu
            isSplit={isSplit}
            onCollapse={collapseSplit}
            onSplit={splitOff}
            open={splitMenuOpen}
            setOpen={setSplitMenuOpen}
          />
          <button
            aria-keyshortcuts={shortcutKeys('F')}
            aria-label="Find"
            className="icon-button panel__chrome-button"
            onClick={openFind}
            title={`Open the find bar (${shortcutLabel('F')})`}
            type="button"
          >
            <Search aria-hidden="true" size={16} />
          </button>
          <ShortcutsHelp />
        </div>

        <form
          className={`panel__body${sidebarOpen ? '' : ' panel__body--rail'}`}
          // There is nothing to submit — the notes write themselves. The form element
          // stays because it carries the panel's layout, and because the capture box's
          // Enter guard is written against the panel being one form around every note.
          onSubmit={(event) => event.preventDefault()}
        >
          {sidebarOpen ? (
            /*
             * One sidebar holding both things a reader navigates with: where they are in
             * the note in front of them, and every note behind it. Stacked rather than
             * switched between, so choosing which of the two you want is not a question you
             * have to answer before you can look at either.
             */
            <aside
              aria-label="Notes and outline"
              className="panel__sidebar"
              ref={sidebarRef}
              /*
               * The two halves divide the column between them, so what one gives up the
               * other takes — a folded half is a heading and nothing more, and the one
               * still open has the rest. `fr` says exactly that, where a height on the
               * outline said only how tall the outline was and left the space it was not
               * using to no one.
               */
              style={{
                gridTemplateRows: outlineShown && notesShown
                  ? `minmax(0, ${outlineShare}fr) auto minmax(0, ${
                      Math.round((1 - outlineShare) * 100) / 100
                    }fr)`
                  : outlineShown
                    ? 'minmax(0, 1fr) auto'
                    : notesShown
                      ? 'auto minmax(0, 1fr)'
                      : 'auto auto',
              }}
            >
              <section aria-label="Outline" className="panel__sidebar-section">
                <SidebarHeading
                  label="Outline"
                  names="the outline"
                  onToggle={() => setOutlineShown((shown) => !shown)}
                  shown={outlineShown}
                />
                {outlineShown ? (
                  outline.length > 0 ? (
                    <div className="panel__outline-scroll">
                      <OutlineList
                        current={trailKey}
                        depth={0}
                        nodes={outline}
                        onPick={jumpToSection}
                        path={trailKeys}
                      />
                    </div>
                  ) : (
                    <p className="stage-notes__hint">
                      {activeBody.trim()
                        ? 'This note has no headings to outline.'
                        : 'Nothing written for this stage yet.'}
                    </p>
                  )
                ) : null}
              </section>

              {/* Only with something on either side of it to divide. */}
              {outlineShown && notesShown ? (
                <div
                  aria-label="Resize the outline"
                  aria-orientation="horizontal"
                  aria-valuemax={Math.round(MAX_OUTLINE_SHARE * 100)}
                  aria-valuemin={Math.round(MIN_OUTLINE_SHARE * 100)}
                  aria-valuenow={Math.round(outlineShare * 100)}
                  aria-valuetext={`Outline takes ${Math.round(outlineShare * 100)}% of the sidebar`}
                  className="panel__sidebar-split"
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                    event.preventDefault()
                    resizeOutline(event.key === 'ArrowDown' ? OUTLINE_SHARE_STEP : -OUTLINE_SHARE_STEP)
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    beginOutlineDrag(event.clientY)
                  }}
                  role="separator"
                  tabIndex={0}
                />
              ) : null}

              <section aria-label="All prep notes" className="panel__sidebar-section">
                <SidebarHeading
                  label="All prep notes"
                  names="all prep notes"
                  onToggle={() => setNotesShown((shown) => !shown)}
                  shown={notesShown}
                />
                {notesShown ? (
                <NotesTreeView
                  applications={applications}
                  currentKey={activeKey}
                  draggingKey={drag.key}
                  onDragStart={drag.start}
                  onPick={showRef}
                  onPickMatch={findInNote}
                  openKeys={openKeys}
                  wasDragged={drag.wasDragged}
                />
                ) : null}
              </section>

            </aside>
          ) : null}

          {/*
            * The sidebar's own edge, a real `separator` with arrow keys like the handles
            * between panes and the one over the dock. Drawn once beside whichever panel is
            * open rather than once per panel — it moves the column, not what is in it —
            * after the panel rather than before it, the body being a grid whose columns are
            * filled in the order its children appear, and whether the sidebar is open or
            * shut, because it is how the sidebar comes back as well as how it goes.
            */}
          <div
            aria-label="Resize the sidebar"
            aria-orientation="vertical"
            aria-valuemax={MAX_SIDEBAR}
            aria-valuemin={MIN_SIDEBAR}
            aria-valuenow={sidebarWidth}
            className="panel__sidebar-resize"
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              resizeSidebar(event.key === 'ArrowRight' ? SIDEBAR_STEP : -SIDEBAR_STEP)
            }}
            onMouseDown={(event) => {
              event.preventDefault()
              // From the body's own left edge, which is where the sidebar begins — with it
              // shut there is no sidebar box to measure against.
              beginSidebarDrag(event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0)
            }}
            role="separator"
            tabIndex={0}
          />

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

            {quickOpen !== null ? (
              <QuickOpen
                entries={quickOpenEntries}
                onClose={() => {
                  setQuickOpen(null)
                  panelRef.current?.focus()
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
    </div>
  )
}
