import { useMemo, type PointerEvent as ReactPointerEvent } from 'react'
import { Search } from 'lucide-react'
import type { Application } from './domain'
import { splitMatches } from './markdown'
import { buildNotesTree, buildPostingsTree, notesInTree, type NotesTreeEntry } from './notesTree'
import { noteRefKey, type NoteRef } from './notesLayout'

/** What every row in either list needs, whatever list it is in. */
interface RowHandlers {
  /** The notes already open, so a list can say which of them you are looking at. */
  openKeys: ReadonlySet<string>
  /** The note on show in the focused pane. */
  currentKey: string | null
  onPick: (ref: NoteRef) => void
  /**
   * Opens a note and runs the panel's own find on the words that matched, which is what
   * paints the highlight and opens a fold holding one. A list marks its snippets so a hit
   * can be recognised before it is picked; landing on it is the find's job, not a second
   * highlighting of the same words by other means.
   */
  onPickMatch: (ref: NoteRef, query: string) => void
  /**
   * Takes hold of a row, so a note can be dragged onto the pane it should open in rather
   * than into whichever one happens to be focused. The same drag the tabs use, so a row
   * lands in the same places a tab does — among another pane's tabs, or on a pane's edge to
   * split one open there.
   */
  onDragStart: (event: ReactPointerEvent<HTMLElement>, key: string) => void
  /** The note being dragged right now, so its row reads as picked up. */
  draggingKey: string | null
  /**
   * Whether the press that just ended was a drag. A browser sends a click after a pointer
   * sequence, and a note dropped on one pane must not also open in another.
   */
  wasDragged: () => boolean
  /** The words being searched for, which the snippets highlight and the find is handed. */
  query: string
}

interface NoteRowsProps extends RowHandlers {
  notes: readonly NotesTreeEntry[]
  describedBy?: string
  label?: string
}

/**
 * The rows themselves, shared by both lists in the sidebar.
 *
 * One component because a row is the same thing in each — a name, what is in it, and the
 * hits under it — and the two lists differ only in what groups them: prep notes by the
 * stage they prepare for, postings by nothing, having no stage to be grouped by.
 */
function NoteRows({
  notes,
  describedBy,
  label,
  openKeys,
  currentKey,
  onPick,
  onPickMatch,
  onDragStart,
  draggingKey,
  wasDragged,
  query,
}: NoteRowsProps) {
  return (
    <ul aria-describedby={describedBy} aria-label={label} className="notes-tree__notes">
      {notes.map((note) => {
        const key = noteRefKey(note.ref)
        const name = `${note.company}${note.role ? ` · ${note.role}` : ''}`
        return (
          <li key={key}>
            <button
              aria-current={key === currentKey ? 'true' : undefined}
              className={[
                'notes-tree__note',
                openKeys.has(key) ? 'notes-tree__note--open' : '',
                key === currentKey ? 'notes-tree__note--current' : '',
                key === draggingKey ? 'notes-tree__note--dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                if (wasDragged()) return
                onPick(note.ref)
              }}
              onPointerDown={(event) => onDragStart(event, key)}
              type="button"
            >
              {/* The column is narrow and a name is long, so the name is truncated and
                  carries itself as a tooltip: a row reading "Halcyon Maps · Engineerin…"
                  says which company and not which role, and the role is half of what tells
                  two rows apart. */}
              <span className="notes-tree__name" title={name}>
                {name}
              </span>
              {/* What is in it, so a row can be read before it is opened: a stage holding
                  only what you were told is worth telling apart from one you prepared. */}
              {note.captured > 0 ? (
                <span className="notes-tree__said">
                  {note.written ? '' : 'only '}
                  {note.captured} said
                </span>
              ) : null}
            </button>

            {note.matches.length > 0 ? (
              /*
               * The hits themselves, under the note holding them. A search that only listed
               * which notes matched left the reader opening each one to find out why; the
               * words are what they were looking for.
               */
              <ul aria-label={`Matches in ${name}`} className="notes-tree__hits">
                {note.matches.map((match, index) => (
                  // Keyed by position: two identical snippets in one note are two hits, and
                  // there is nothing else to tell them apart by.
                  <li key={`${match.where}-${index}`}>
                    <button
                      className="notes-tree__hit"
                      onClick={() => {
                        if (wasDragged()) return
                        onPickMatch(note.ref, query.trim())
                      }}
                      title={match.snippet}
                      type="button"
                    >
                      <span className="notes-tree__hit-text">
                        {splitMatches(match.snippet, query.trim()).map((segment, at) => (
                          // Keyed by position: the same word twice in one snippet is two
                          // segments with nothing else to tell them apart.
                          <span
                            className={segment.isMatch ? 'markdown__match' : undefined}
                            key={`${at}-${segment.text}`}
                          >
                            {segment.text}
                          </span>
                        ))}
                      </span>
                      {match.where === 'captured' ? (
                        <span className="notes-tree__hit-where">said</span>
                      ) : null}
                    </button>
                  </li>
                ))}
                {note.hits > note.matches.length ? (
                  <li className="notes-tree__more">
                    {note.hits - note.matches.length} more in this note
                  </li>
                ) : null}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

interface NotesTreeSearchProps {
  query: string
  onChange: (query: string) => void
}

/**
 * One search over everything behind the note in front of you, postings and prep notes
 * alike. Above both lists rather than inside either: a box in one section that filtered the
 * other would be a control acting somewhere it does not appear.
 */
export function NotesTreeSearch({ query, onChange }: NotesTreeSearchProps) {
  return (
    <div className="search-field notes-tree__search">
      <Search aria-hidden="true" size={15} />
      <input
        aria-label="Search postings and prep notes"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Clears the search rather than travelling on, the way the find bar and the stage
          // picker each answer Escape from their own input.
          if (event.key !== 'Escape' || !query) return
          event.preventDefault()
          event.stopPropagation()
          onChange('')
        }}
        placeholder="Search postings and notes"
        type="search"
        value={query}
      />
    </div>
  )
}

interface NotesTreeProps extends RowHandlers {
  /** Every application: a note worth browsing to is usually one that is not open. */
  applications: Application[]
}

/**
 * Every prep note worth going back to, grouped by the stage it prepares for.
 *
 * Postings are not in here. They are not prep notes — nobody wrote them — and a list headed
 * as prep notes may not hold things nobody wrote; `PostingsTreeView` is theirs.
 */
export function NotesTreeView({ applications, ...rows }: NotesTreeProps) {
  const hintId = 'notes-tree-hint'
  const tree = useMemo(() => buildNotesTree(applications, rows.query), [applications, rows.query])
  const total = notesInTree(tree)

  return (
    <div className="notes-tree">
      {/* The only way a drag is discoverable without a pointer, and the only way its
          keyboard equivalent is discoverable at all. */}
      <p className="sr-only" id={hintId}>
        Drag a note onto a pane to open it there, or onto a pane’s edge to split one open.
        Choosing one opens it in the pane you are reading, which the tab shortcuts then move.
      </p>

      {total === 0 ? (
        <p className="stage-notes__hint">
          {rows.query.trim()
            ? 'No prep note holds those words.'
            : 'Nothing written yet. Notes you write appear here, under the stage they prepare for.'}
        </p>
      ) : (
        <ul aria-describedby={hintId} aria-label="Prep notes by stage" className="notes-tree__stages">
          {tree.map((group) => (
            // Labelled so the stage a row sits under is part of what names it, the way the
            // picker's company heading names the roles beneath it.
            <li aria-label={`Stage ${group.label}`} key={group.state}>
              <p className="notes-tree__stage">
                {/* Its own element so it can give way to the count beside it when the
                    sidebar is narrow, rather than pushing the count out of the row. */}
                <span className="notes-tree__stage-name" title={group.label}>
                  {group.label}
                </span>
                <span className="notes-tree__count">{group.notes.length}</span>
              </p>
              <NoteRows notes={group.notes} {...rows} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Every captured job posting, as a flat list.
 *
 * Flat because a posting belongs to no stage, so there is nothing to group it under, and the
 * section's own heading already says what these are.
 */
export function PostingsTreeView({ applications, ...rows }: NotesTreeProps) {
  const postings = useMemo(
    () => buildPostingsTree(applications, rows.query),
    [applications, rows.query],
  )

  return (
    <div className="notes-tree">
      {postings.length === 0 ? (
        <p className="stage-notes__hint">
          {rows.query.trim()
            ? 'No posting holds those words.'
            : 'No postings captured yet. Paste one into an application to keep what it said.'}
        </p>
      ) : (
        <NoteRows label="Job postings" notes={postings} {...rows} />
      )}
    </div>
  )
}
