export type StateId =
  | 'headhunted'
  | 'no_openings'
  | 'applied'
  | 'auto_rejected'
  | 'recruiter_messaged'
  | 'recruiter_messaged_rejected'
  | 'online_assessment'
  | 'online_assessment_rejected'
  | 'recruiter_interview'
  | 'recruiter_interview_rejected'
  | 'take_home_assessment'
  | 'take_home_assessment_rejected'
  | 'interview_1'
  | 'interview_1_rejected'
  | 'interview_2'
  | 'interview_2_rejected'
  | 'offer'
  | 'offer_rejected'
  | 'accepted'

export interface StateHistoryEntry {
  state: StateId
  at: string
}

export interface StageNote {
  state: StateId
  body: string
  created_at: string
  updated_at: string
}

/** A stage prep note as edited in the UI, before timestamps are resolved. */
export interface StageNoteDraft {
  state: StateId
  body: string
}

/**
 * A calendar invite filed against one state of an application. `ics_uid` is the
 * iCalendar UID it arrived with, which is how a rescheduled invite replaces the
 * one it supersedes instead of sitting beside it.
 */
export interface StateEvent {
  id: string
  state: StateId
  summary: string
  starts_at: string
  ends_at: string | null
  location: string | null
  url: string | null
  ics_uid: string | null
  sequence: number
  cancelled: boolean
  created_at: string
  updated_at: string
}

/** An invite as edited in the UI, before an id and timestamps are resolved. */
export interface StateEventDraft {
  id?: string
  state: StateId
  summary: string
  starts_at: string
  ends_at?: string | null
  location?: string | null
  url?: string | null
  ics_uid?: string | null
  sequence?: number
  cancelled?: boolean
}

export interface Attachment {
  id: string
  filename: string
  mime: string | null
  size: number
  created_at: string
}

export interface Application {
  id: string
  company: string
  role: string | null
  url: string | null
  source: string | null
  state: StateId
  state_history: StateHistoryEntry[]
  next_action: string | null
  next_action_at: string | null
  deadline_at: string | null
  notes: string | null
  stage_notes: StageNote[]
  state_events: StateEvent[]
  attachments: Attachment[]
  created_at: string
  updated_at: string
}

export type JsonSchemaObject = Record<string, unknown>

export interface TrackerIndexes {
  by_id: Record<string, number>
  by_state: Record<StateId, string[]>
  by_company: Record<string, string[]>
  by_created_at: string[]
  by_updated_at: string[]
  by_next_action_at: string[]
  by_deadline_at: string[]
  with_next_action: string[]
  unscheduled_next_actions: string[]
  ever_reached: Record<StateId, string[]>
  search_text: Record<string, string>
  stats_current: Record<StateId, number>
  stats_ever_reached: Record<StateId, number>
}

export interface TrackerDatabase {
  schema: JsonSchemaObject
  applications: Application[]
  indexes: TrackerIndexes
}

/** Canonical persisted tracker document (JSON file database). */
export type TrackerDocument = TrackerDatabase

export interface LegacyTrackerDocument {
  schema_version: 1
  applications: Application[]
}

export interface ApplicationInput {
  company: string
  role?: string | null
  url?: string | null
  source?: string | null
  state?: StateId
  next_action?: string | null
  next_action_at?: string | null
  deadline_at?: string | null
  notes?: string | null
}

export type ApplicationEdits = Partial<
  Pick<
    Application,
    | 'company'
    | 'role'
    | 'url'
    | 'source'
    | 'next_action'
    | 'next_action_at'
    | 'deadline_at'
    | 'notes'
    | 'attachments'
  >
>
