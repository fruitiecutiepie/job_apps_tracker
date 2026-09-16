import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Search } from 'lucide-react'
import type { Application } from './domain'
import { splitMatches } from './markdown'
import { buildNotesTree, notesInTree } from './notesTree'
import { noteRefKey, type NoteRef } from './notesLayout'

interface NotesTreeProps {
  /** Every application: a note worth browsing to is usually one that is not open. */
  applications: Application[]
  /** The notes already open, so the tree can say which of them you are looking at. */
  openKeys: ReadonlySet<string>
  /** The note on show in the focused pane. */
  currentKey: string | null
  onPick: (ref: NoteRef) => void
  /**
   * Opens a note and runs the panel's own find on the words that matched, which is what
   * paints the highlight and opens a fold holding one. The tree marks its snippets so a
   * hit can be recognised before it is picked; landing on it is the find's job, not a
   * second highlighting of the same words by other means.
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
}

/**
 * Every prep note worth going back to, grouped by the stage it prepares for.
 *
 * The panel's other sidebar is the outline of the note you are reading; this is the way
 * to the ones you are not. They share a rail rather than a column, so reaching for one
 * never costs the width of the other.
 *
 * The search filters this tree in place instead of replacing it with a list of results:
 * the grouping is what makes a result legible — which stage a note prepares for is most of
 * what tells two of them apart — and losing it on the first keystroke would trade the one
 * thing the tree is for.
 */
export function NotesTreeView({
  applications,
  openKeys,
  currentKey,
  onPick,
  onPickMatch,
  onDragStart,
  draggingKey,
  wasDragged,
}: NotesTreeProps) {
  const hintId = 'notes-tree-hint'
  const [query, setQuery] = useState('')
  const tree = useMemo(() => buildNotesTree(applications, query), [applications, query])
  const total = notesInTree(tree)

  return (
    <div className="notes-tree">
      <div className="search-field notes-tree__search">
        <Search aria-hidden="true" size={15} />
        <input
          aria-label="Search prep notes"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Clears the search rather than travelling on, the way the find bar and the
            // stage picker each answer Escape from their own input.
            if (event.key !== 'Escape' || !query) return
            event.preventDefault()
            event.stopPropagation()
            setQuery('')
          }}
          placeholder="Search notes"
          type="search"
          value={query}
        />
      </div>

      {/* The only way a drag is discoverable without a pointer, and the only way its
          keyboard equivalent is discoverable at all. */}
      <p className="sr-only" id={hintId}>
        Drag a note onto a pane to open it there, or onto a pane’s edge to split one open.
        Choosing one opens it in the pane you are reading, which the tab shortcuts then move.
      </p>

      {total === 0 ? (
        <p className="stage-notes__hint">
          {query.trim()
            ? 'No prep note holds those words.'
            : 'Nothing written yet. Notes you write appear here, under the stage they prepare for.'}
        </p>
      ) : (
        <ul aria-describedby={hintId} aria-label="Prep notes by stage" className="notes-tree__stages">
          {tree.map((group) => (
            // Labelled so the stage a row sits under is part of what names it, the way the
            // picker's company heading names the roles beneath it.
            // A posting group is named by what it holds; a stage group by the stage.
            <li
              aria-label={group.kind === 'posting' ? group.label : `Stage ${group.label}`}
              key={group.kind === 'posting' ? 'posting' : group.state}
            >
              <p className="notes-tree__stage">
                {/* Its own element so it can give way to the count beside it when the
                    sidebar is narrow, rather than pushing the count out of the row. */}
                <span className="notes-tree__stage-name" title={group.label}>
                  {group.label}
                </span>
                <span className="notes-tree__count">{group.notes.length}</span>
              </p>
              <ul className="notes-tree__notes">
                {group.notes.map((note) => {
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
                        {/* The column is narrow and a name is long, so the name is
                            truncated and carries itself as a tooltip: a row reading
                            "Halcyon Maps · Engineerin…" says which company and not which
                            role, and the role is half of what tells two rows apart. */}
                        <span className="notes-tree__name" title={name}>
                          {name}
                        </span>
                        {/* What is in it, so a row can be read before it is opened: a stage
                            holding only what you were told is worth telling apart from one
                            you prepared. */}
                        {note.captured > 0 ? (
                          <span className="notes-tree__said">
                            {note.written ? '' : 'only '}
                            {note.captured} said
                          </span>
                        ) : null}
                      </button>

                      {note.matches.length > 0 ? (
                        /*
                         * The hits themselves, under the note holding them. A search that
                         * only listed which notes matched left the reader opening each one
                         * to find out why; the words are what they were looking for.
                         */
                        <ul aria-label={`Matches in ${name}`} className="notes-tree__hits">
                          {note.matches.map((match, index) => (
                            // Keyed by position: two identical snippets in one note are two
                            // hits, and there is nothing else to tell them apart by.
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
                                    // Keyed by position: the same word twice in one snippet
                                    // is two segments with nothing else to tell them apart.
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
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
