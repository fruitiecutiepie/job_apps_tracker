/**
 * Element ids tying a tab to the pane showing it. They live apart from both components
 * because the tab and the pane each need to name the other, and a pane is labelled by its
 * own heading rather than by its tab: a tab also carries the current-stage badge and a
 * live match count, and neither belongs in the name of the note beside it.
 *
 * Keyed by the application as well as the state. Two applications open at the same stage
 * is the ordinary case now, and an id built from the state alone would give both notes
 * one tab, one panel and one set of find ordinals.
 */

import { noteRefKey, type NoteRef } from './notesLayout'

/**
 * A note's key as an id fragment. The key's own separator is dropped for one that cannot
 * be read as a pseudo-element, so these ids stay usable in a selector.
 */
const idPart = (ref: NoteRef) => noteRefKey(ref).replace('::', '--')

export const stageTabId = (ref: NoteRef) => `stage-tab-${idPart(ref)}`
export const stageNotePanelId = (ref: NoteRef) => `stage-note-panel-${idPart(ref)}`
export const stageNoteHeadingId = (ref: NoteRef) => `stage-note-heading-${idPart(ref)}`
