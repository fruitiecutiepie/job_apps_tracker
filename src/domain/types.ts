/**
 * How far an application has got: the stage it is at, or was at when it ended. It says
 * nothing about whether it is still running — that is `OutcomeId`, a second field beside it —
 * so every stage has one id however the application ends, and a prep note, an invite or a
 * message is filed against the conversation it belongs to rather than against how that
 * conversation turned out.
 */
export type StateId = BuiltinStateId | RoundId

/** The stages every tracker has, whatever it calls them. */
export type BuiltinStateId =
  | 'headhunted'
  | 'applied'
  | 'recruiter_messaged'
  | 'online_assessment'
  | 'screening'
  | 'take_home_assessment'
  | 'offer'
  | 'accepted'

/**
 * An interview round, counted from 1. Every tracker has two; more are added per tracker, and
 * a tracker holds exactly the rounds from 1 up to its count, so an id is only a valid stage in
 * a tracker that has that round.
 */
export type RoundId = `round_${number}`

/** One stage of a tracker and what it is called there. */
export interface StageSetting {
  id: StateId
  label: string
}

/**
 * Whether an application is still running and, when it is not, who ended it. `withdrawn` is
 * you pulling out; `closed` is the employer ending it without turning you down — the role was
 * filled, pulled or frozen, or they went silent; `rejected` is them turning you down. Taking
 * the job is not an outcome: it is the last stage, Accepted.
 */
export type OutcomeId = 'active' | 'rejected' | 'withdrawn' | 'closed'

/** Where an application stands: its stage and how that stage is going. */
export interface Status {
  state: StateId
  outcome: OutcomeId
}

export type RatingDimensionId = 'work' | 'growth' | 'people' | 'company'

export type CompensationStageId = 'advertised' | 'expected' | 'offered'

export interface StateHistoryEntry {
  state: StateId
  outcome: OutcomeId
  at: string
}

/**
 * One line captured while a stage was being read: what you were told, and when. Stored as
 * a record rather than as text inside the note's `body` because the two are written at
 * different moments by different hands — `body` is prepared and saved deliberately, a
 * captured line is typed mid-conversation and stored the instant it is entered — and
 * because the day a line belongs to is then a reading of `at` rather than something to be
 * parsed back out of a heading.
 *
 * There is no author field. A stage note already says which conversation this is, and
 * asking who was speaking is a question to answer mid-interview that is not worth the
 * keystrokes; a name that matters goes in the line.
 */
export interface HeardEntry {
  id: string
  body: string
  at: string
}

/**
 * A next action that was carried out, kept as a record rather than appended to `notes`. The
 * two are written at different moments by different hands: `notes` is prose you compose and
 * revise, while a completed action is one line the app writes the instant you press Done. As
 * a record the date is a reading of `at` rather than something to parse back out of the prose,
 * a mistaken Done can be removed without editing around it, and neither can clobber the other.
 *
 * There is no separate "planned at" field. What matters is that the task was done and when;
 * when you first wrote it down is not something anyone goes looking for.
 */
export interface CompletedAction {
  id: string
  action: string
  at: string
}

/** A completed action as held by the editor, before an id and timestamp are resolved. */
export interface CompletedActionDraft {
  id?: string
  action: string
  at?: string
}

export interface StageNote {
  state: StateId
  body: string
  /** Lines captured during this stage, oldest first. */
  heard: HeardEntry[]
  created_at: string
  updated_at: string
}

/**
 * A stage prep note as edited in the UI, before timestamps are resolved. It carries no
 * captured lines: those are stored as they are typed and never pass through a draft, so
 * saving the notes panel cannot roll one back or write one twice.
 */
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

export type CorrespondenceDirection = 'received' | 'sent'

/**
 * One message exchanged with an employer, filed against one state: a recruiter's email, a
 * LinkedIn message, a rejection note, and what you sent back. It is deliberately not a third
 * mode of `stage_notes`. A prep note is what you wrote before a stage and a `HeardEntry` is a
 * line typed mid-conversation; a message is neither, because someone else wrote it at a
 * moment you are only recording after the fact.
 *
 * `at` is when the message was sent and it is **supplied rather than minted**: you log on
 * Friday what arrived on Tuesday, so a timestamp taken off the clock at the moment of filing
 * would be a claim about your typing rather than about the conversation. It may also be
 * corrected, which is where this record and `HeardEntry` part company — a send time is a fact
 * about the world you can simply have got wrong, while a captured line's `at` may not move
 * because an edit there is a correction to what was written down. `created_at` is when you
 * wrote the record and never moves. Both are stored because they answer different questions,
 * which is also why `HeardEntry` and `CompletedAction` need only one timestamp each.
 *
 * `who` is the other person — the sender of a message received, the recipient of one sent.
 * `HeardEntry` deliberately has no author and that is not a contradiction: a captured line
 * comes from the room its stage note already names, while one application's log mixes a
 * recruiter, a coordinator and a hiring manager and cannot be read without it.
 */
export interface CorrespondenceEntry {
  id: string
  state: StateId
  direction: CorrespondenceDirection
  /**
   * What the message was about, when it came with one. Optional because a LinkedIn message
   * or an SMS has none — and those are exactly the messages whose first line makes a good
   * summary on its own. Where it is present it is also the thread: messages sharing a
   * subject within a stage are the same conversation, which is why there is no separate
   * thread id to keep in step with it.
   */
  subject: string | null
  /** How it arrived. Free text, because the next one may come by SMS. */
  channel: string | null
  /** The other person: the sender when received, the recipient when sent. */
  who: string | null
  body: string
  /** When the message was sent, as supplied. */
  at: string
  /** When this record was written down. */
  created_at: string
  updated_at: string
}

/**
 * A message as edited in the UI, before an id and record timestamps are resolved. `at` is
 * required here, unlike `CompletedActionDraft.at`: a draft with no send time is refused
 * rather than stamped now, because stamping it now silently is exactly the dishonest
 * timestamp this record exists to end.
 */
export interface CorrespondenceDraft {
  id?: string
  state: StateId
  direction: CorrespondenceDirection
  subject?: string | null
  channel?: string | null
  who?: string | null
  body: string
  at: string
}

export interface Attachment {
  id: string
  filename: string
  mime: string | null
  size: number
  created_at: string
}

/**
 * The job posting as it read when you captured it, in Markdown.
 *
 * Listings get taken down, quietly reworded, or moved behind a login, so the `url` on an
 * application is not a reliable way back to what you actually applied to. The text is
 * pasted in by hand rather than fetched: postings are routinely JS-rendered or
 * login-walled, and this tracker talks to no network but its own file.
 */
export interface Posting {
  /** Markdown source, never blank — a posting with no text is no posting, and stored as `null`. */
  body: string
  /** When the text was pasted in. A later edit to `source_url` alone does not move it. */
  captured_at: string
  source_url: string | null
}

/** What the editor hands the mutation: `captured_at` is the document's to assign, not the form's. */
export interface PostingDraft {
  body: string
  source_url?: string | null
}

export interface Application {
  id: string
  company: string
  role: string | null
  url: string | null
  source: string | null
  state: StateId
  outcome: OutcomeId
  state_history: StateHistoryEntry[]
  /**
   * When the application was put away, or null. A visibility flag rather than an outcome:
   * archiving keeps how it ended, and hides it so the next job search does not start among
   * the last one's leftovers.
   */
  archived_at: string | null
  next_action: string | null
  next_action_at: string | null
  deadline_at: string | null
  notes: string | null
  /** Next actions carried out, oldest first. */
  completed_actions: CompletedAction[]
  stage_notes: StageNote[]
  state_events: StateEvent[]
  /** Messages exchanged with the employer, oldest first by the time they were sent. */
  correspondence: CorrespondenceEntry[]
  attachments: Attachment[]
  posting: Posting | null
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
  by_outcome: Record<OutcomeId, string[]>
  ever_reached: Record<StateId, string[]>
  search_text: Record<string, string>
  stats_current: Record<StateId, number>
  stats_ever_reached: Record<StateId, number>
}

export interface TrackerDatabase {
  /** The document layout this file is written in; see `DATA_VERSION`. */
  schema_version: 4
  schema: JsonSchemaObject
  /**
   * What the reader called this tracker, absent until they name it. In the document rather
   * than beside it because a name is part of what the file is: it has to travel with the
   * folder, an export, and a move to another browser, none of which browser storage does.
   */
  name?: string
  /**
   * Every stage in order with what this tracker calls it, absent while they are the defaults.
   * In the document for the reason `name` is: a stage renamed or a round added is part of
   * what the applications mean, and has to travel with them.
   */
  stages?: StageSetting[]
  applications: Application[]
  indexes: TrackerIndexes
}

/** Canonical persisted tracker document (JSON file database). */
export type TrackerDocument = TrackerDatabase

/** An export from before the document embedded its schema. Migrated on import. */
export interface LegacyTrackerDocument {
  schema_version: 1
  applications: unknown[]
}

export interface ApplicationInput {
  company: string
  role?: string | null
  url?: string | null
  source?: string | null
  state?: StateId
  outcome?: OutcomeId
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
    // Unlike `ratings`, `stage_notes`, `state_events`, and `correspondence`, compensation carries no
    // per-record timestamps, so there is nothing a second write path could destroy: the
    // whole record is replaced at once, exactly the way `deadline_at` is.
    | 'compensation'
  >
>
