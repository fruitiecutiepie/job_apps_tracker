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

export type RatingDimensionId = 'work' | 'growth' | 'people' | 'company'

export type CompensationStageId = 'advertised' | 'expected' | 'offered'

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
 * One judgement of an application on one dimension. Three states are meaningful and
 * distinct: no record at all means never assessed, `score: null` means asked and genuinely
 * cannot tell, and an integer score means a judgement was made.
 */
export interface Rating {
  dimension: RatingDimensionId
  score: number | null
  created_at: string
  updated_at: string
}

/** A rating as edited in the UI, before timestamps are resolved. */
export interface RatingDraft {
  dimension: RatingDimensionId
  score: number | null
}

/**
 * One pay figure, always stored as a band because that is what a posting gives you
 * ("130-150k"). A point value is a band whose ends match, which keeps one representation
 * instead of two and spares every reader an `if (max === null)`. Both ends are annual gross
 * base pay in whole units of the compensation record's currency.
 */
export interface CompensationBand {
  min: number
  max: number
}

/**
 * What an application pays, as a measurement rather than a judgement. The three stages are
 * kept side by side because compensation moves and the progression is the point: `advertised`
 * is what the posting or recruiter said, `offered` is what arrived in writing, and `expected`
 * is what you are aiming for at this employer.
 *
 * `expected` doubles as the target the other two are measured against. There is deliberately
 * no global target: the document shape is closed and discards any extra top-level key, so
 * there is nowhere honest to persist one — and a single number could not be compared against
 * a per-application currency anyway. What you would accept genuinely differs by role, level,
 * and country, so it belongs on the application.
 *
 * `currency` covers the whole record rather than each band: one application is one employer
 * discussing one salary, and letting the stages disagree would make the progression
 * meaningless. It is non-null exactly when some stage holds a figure.
 */
export interface Compensation {
  currency: string | null
  advertised: CompensationBand | null
  expected: CompensationBand | null
  offered: CompensationBand | null
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
  ratings: Rating[]
  compensation: Compensation
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
  // No `| null` here, unlike the text fields: "no compensation recorded" is a whole empty
  // record, not an absent one, so there is no second way to say it.
  compensation?: Compensation
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
    // Unlike `ratings`, `stage_notes`, and `state_events`, compensation carries no
    // per-record timestamps, so there is nothing a second write path could destroy: the
    // whole record is replaced at once, exactly the way `deadline_at` is.
    | 'compensation'
  >
>
