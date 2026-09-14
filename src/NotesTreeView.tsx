import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { Application } from './domain'
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
export function NotesTreeView({ applications, openKeys, currentKey, onPick }: NotesTreeProps) {
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

      {total === 0 ? (
        <p className="stage-notes__hint">
          {query.trim()
            ? 'No prep note holds those words.'
            : 'Nothing written yet. Notes you write appear here, under the stage they prepare for.'}
        </p>
      ) : (
        <ul aria-label="Prep notes by stage" className="notes-tree__stages">
          {tree.map((group) => (
            // Labelled so the stage a row sits under is part of what names it, the way the
            // picker's company heading names the roles beneath it.
            <li aria-label={`Stage ${group.label}`} key={group.state}>
              <p className="notes-tree__stage">
                {group.label}
                <span className="notes-tree__count">{group.notes.length}</span>
              </p>
              <ul className="notes-tree__notes">
                {group.notes.map((note) => {
                  const key = noteRefKey(note.ref)
                  return (
                    <li key={key}>
                      <button
                        aria-current={key === currentKey ? 'true' : undefined}
                        className={[
                          'notes-tree__note',
                          openKeys.has(key) ? 'notes-tree__note--open' : '',
                          key === currentKey ? 'notes-tree__note--current' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => onPick(note.ref)}
                        type="button"
                      >
                        <span className="notes-tree__name">
                          {note.company}
                          {note.role ? ` · ${note.role}` : ''}
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
