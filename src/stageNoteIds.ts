/**
 * Element ids tying a stage's tab to the pane showing it. They live apart from both
 * components because the tab and the pane each need to name the other, and a pane is
 * labelled by its own heading rather than by its tab: a tab also carries the
 * current-stage badge and a live match count, and neither belongs in the name of the
 * note beside it.
 */

import type { StateId } from './domain'

export const stageTabId = (state: StateId) => `stage-tab-${state}`
export const stageNotePanelId = (state: StateId) => `stage-note-panel-${state}`
export const stageNoteHeadingId = (state: StateId) => `stage-note-heading-${state}`
