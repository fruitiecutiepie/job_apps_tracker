import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Application } from "../domain";
import { stateLabel } from "../domain";
import type { NoteRef } from "../notesLayout";
import { searchPrepNotes } from "../prepNotesSearch";

interface PrepNotesSearchProps {
  /** Every application, since a note worth finding is usually one that is not open. */
  applications: Application[];
  onOpen: (ref: NoteRef) => void;
}

/** How many results are worth showing before the list is longer than it is useful. */
const RESULT_LIMIT = 8;

/**
 * Finding a form of words across every prep note, from the view's own context bar.
 *
 * This is the one collection-wide question the prep notes view can answer, and it stands
 * where the collection's search and filters stand on every other view — which is the point:
 * the bar carries what this view can actually be asked, rather than controls that would do
 * nothing here.
 *
 * A list of buttons under a search box rather than a combobox: the results are a short list
 * of places to go, Tab already reaches buttons in DOM order, and the arrow keys are here so
 * the list can be walked without leaving the box. The same shape the stage picker keeps.
 */
export function PrepNotesSearch({ applications, onOpen }: PrepNotesSearchProps) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => searchPrepNotes(applications, query).slice(0, RESULT_LIMIT),
    [applications, query],
  );

  const open = (ref: NoteRef) => {
    onOpen(ref);
    setQuery("");
    setHighlighted(0);
  };

  return (
    <div className="notes-search">
      <div className="search-field">
        <Search aria-hidden="true" size={15} />
        <input
          aria-label="Search prep notes"
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlighted(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              // Clears the search before it reaches anything else, the way the find bar and
              // the stage picker each answer Escape from their own input.
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const picked = results[highlighted];
              if (picked) open(picked.ref);
              return;
            }
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            setHighlighted((current) => {
              const next = current + (event.key === "ArrowDown" ? 1 : -1);
              return Math.min(results.length - 1, Math.max(0, next));
            });
          }}
          placeholder="Search what you wrote and what you were told"
          ref={inputRef}
          type="search"
          value={query}
        />
      </div>

      {query.trim() ? (
        <div className="notes-search__results">
          {results.length === 0 ? (
            <p className="notes-search__empty">No prep note holds those words.</p>
          ) : (
            <ul aria-label="Matching prep notes" className="notes-search__list">
              {results.map((hit, index) => (
                <li key={`${hit.ref.applicationId}::${hit.ref.state}`}>
                  <button
                    className={`notes-search__hit${index === highlighted ? " notes-search__hit--on" : ""}`}
                    onClick={() => open(hit.ref)}
                    onFocus={() => setHighlighted(index)}
                    type="button"
                  >
                    <span className="notes-search__where">
                      {hit.company}
                      {hit.role ? ` · ${hit.role}` : ""} · {stateLabel(hit.state)}
                      {/* Which half of the note holds the words, since the two are written
                          at different moments and a reader is usually after one of them. */}
                      <span className="notes-search__half">
                        {hit.where === "captured" ? "what they said" : "note"}
                        {hit.matches > 1 ? ` · ${hit.matches}` : ""}
                      </span>
                    </span>
                    <span className="notes-search__snippet">{hit.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
