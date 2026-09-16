/**
 * Element ids tying a tab to the pane showing it. They live apart from both components
 * because the tab and the pane each need to name the other, and a pane is labelled by its
 * own heading rather than by its tab: a tab also carries the current-stage badge and a
 * live match count, and neither belongs in the name of the note beside it.
 *
 * Keyed by the pane as well as the note. Two applications open at the same stage was
 * already the ordinary case, and one note open in two panes is now one too — an id built
 * from the note alone would give both copies one tab, one panel and one set of find
 * ordinals, which is the whole of what an id here is for.
 */

import { tabId, type NoteRef } from './notesLayout'

/**
 * A copy's id as an id fragment. The separators are dropped for ones that cannot be read
 * as a pseudo-element or a type selector, so these ids stay usable in a selector.
 */
const idPart = (groupId: string, ref: NoteRef) => tabId(groupId, ref).replace('::', '--').replace('@', '__')

export const stageTabId = (groupId: string, ref: NoteRef) => `stage-tab-${idPart(groupId, ref)}`
export const stageNotePanelId = (groupId: string, ref: NoteRef) =>
  `stage-note-panel-${idPart(groupId, ref)}`
export const stageNoteHeadingId = (groupId: string, ref: NoteRef) =>
  `stage-note-heading-${idPart(groupId, ref)}`
