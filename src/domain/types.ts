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
  state: StateId
  state_history: StateHistoryEntry[]
  next_action: string | null
  next_action_at: string | null
  notes: string | null
  attachments: Attachment[]
  created_at: string
  updated_at: string
}

export type JsonSchemaObject = Record<string, unknown>

export interface TrackerIndexes {
  by_id: Record<string, number>
  by_state: Record<StateId, string[]>
  by_updated_at: string[]
  by_next_action_at: string[]
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
  state?: StateId
  next_action?: string | null
  next_action_at?: string | null
  notes?: string | null
}

export type ApplicationEdits = Partial<
  Pick<Application, 'company' | 'role' | 'url' | 'next_action' | 'next_action_at' | 'notes' | 'attachments'>
>
