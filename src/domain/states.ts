import type { BuiltinStateId, OutcomeId, RoundId, StageSetting, StateId, Status } from './types'

/**
 * The stages every tracker starts with, in the order an application usually passes through
 * them. An application's stage is how far it got; whether it is still going is its outcome,
 * below. The last one, Accepted, is where a search succeeds: reached, still active, it is the
 * job you took.
 *
 * These are defaults, not the whole story: a tracker may rename any stage and add rounds
 * after Round 2, which it keeps in its own `stages` (see `stageConfigFrom`). The ids are what
 * the data holds and never change with a label, so a rename touches no application.
 */
export const DEFAULT_STAGES = [
  { id: 'headhunted', label: 'Headhunted' },
  { id: 'applied', label: 'Applied' },
  { id: 'recruiter_messaged', label: 'Recruiter messaged' },
  { id: 'online_assessment', label: 'Online assessment' },
  { id: 'screening', label: 'Screening call' },
  { id: 'take_home_assessment', label: 'Take-home assessment' },
  { id: 'round_1', label: 'Round 1' },
  { id: 'round_2', label: 'Round 2' },
  { id: 'offer', label: 'Offer' },
  { id: 'accepted', label: 'Accepted' },
] as const satisfies readonly StageSetting[]

/** The stages before the rounds and after them; the rounds go between. */
const BEFORE_ROUNDS = DEFAULT_STAGES.slice(0, 6).map(({ id }) => id) as readonly BuiltinStateId[]
const AFTER_ROUNDS = DEFAULT_STAGES.slice(8).map(({ id }) => id) as readonly BuiltinStateId[]
const BUILTIN_IDS = new Set<string>([...BEFORE_ROUNDS, ...AFTER_ROUNDS])

/** Rounds every tracker has. More can be added; these two cannot be taken away. */
export const DEFAULT_ROUNDS = 2

const ROUND_PATTERN = /^round_([1-9][0-9]*)$/

/** The round a stage id names, or null when it is not a round. */
export function roundNumber(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = ROUND_PATTERN.exec(value)
  return match ? Number(match[1]) : null
}

export function roundId(round: number): RoundId {
  return `round_${round}`
}

export function defaultStageLabel(id: StateId): string {
  const round = roundNumber(id)
  if (round !== null) return `Round ${round}`
  return DEFAULT_STAGES.find((stage) => stage.id === id)?.label ?? id
}

/**
 * Whether a value has the shape of a stage id: one of the fixed stages, or a round. Whether a
 * particular tracker holds that round is `isStateId`'s question, not this one.
 */
export function isStageIdShape(value: unknown): value is StateId {
  return typeof value === 'string' && (BUILTIN_IDS.has(value) || roundNumber(value) !== null)
}

/** The stages one tracker reads in, with what it calls each. */
export interface StageConfig {
  readonly stages: readonly StageSetting[]
  readonly ids: readonly StateId[]
  readonly rounds: number
  has(value: unknown): value is StateId
  label(id: StateId): string
  rank(id: StateId): number
}

/**
 * The stages a tracker's stored `stages` describe. The order is fixed — the stages before the
 * rounds, the rounds counted up, then Offer and Accepted — so it is rebuilt here rather than
 * read off the list; what the list contributes is how many rounds there are and any label
 * that differs from its default. Absent, it is the defaults.
 */
export function stageConfigFrom(stored: readonly StageSetting[] | undefined): StageConfig {
  const labels = new Map<string, string>()
  let rounds = DEFAULT_ROUNDS
  for (const { id, label } of stored ?? []) {
    const trimmed = label.trim()
    if (trimmed) labels.set(id, trimmed)
    rounds = Math.max(rounds, roundNumber(id) ?? 0)
  }
  const ids: StateId[] = [
    ...BEFORE_ROUNDS,
    ...Array.from({ length: rounds }, (_, index) => roundId(index + 1)),
    ...AFTER_ROUNDS,
  ]
  const stages = ids.map((id) => ({ id, label: labels.get(id) ?? defaultStageLabel(id) }))
  const byId = new Map(stages.map((stage, index) => [stage.id as string, { ...stage, index }]))
  return {
    stages,
    ids,
    rounds,
    has: (value: unknown): value is StateId => typeof value === 'string' && byId.has(value),
    label: (id) => byId.get(id)?.label ?? defaultStageLabel(id),
    rank: (id) => byId.get(id)?.index ?? ids.length,
  }
}

/**
 * What a tracker stores for its stages: nothing when they are the defaults, so a tracker
 * nobody customised keeps the file it always had, and otherwise every stage in order, so the
 * file says what each one is called without a reader having to know the defaults.
 */
export function storedStages(config: StageConfig): StageSetting[] | undefined {
  const customised = config.rounds !== DEFAULT_ROUNDS
    || config.stages.some(({ id, label }) => label !== defaultStageLabel(id))
  return customised ? config.stages.map(({ id, label }) => ({ id, label })) : undefined
}

export const DEFAULT_STAGE_CONFIG = stageConfigFrom(undefined)

/*
 * The stages of the tracker on screen. A page holds one tracker, and nearly everything that
 * names or orders a stage — a label in a card, a column on the board, the urgency weight — has
 * no document to hand, so the open tracker's stages are module state, set by `applyStages` as the
 * document arrives. These are live bindings: importers see the reassignment.
 */
let current: StageConfig = DEFAULT_STAGE_CONFIG

/** The open tracker's stages, in order. */
export let STATE_CONFIG: readonly StageSetting[] = current.stages
export let STATE_IDS: readonly StateId[] = current.ids

function sameStages(left: StageConfig, right: StageConfig): boolean {
  return left.stages.length === right.stages.length
    && left.stages.every((stage, index) => stage.id === right.stages[index]!.id && stage.label === right.stages[index]!.label)
}

/**
 * Makes these the stages every label, list and order reads. Stages equal to the ones already
 * applied change nothing, so `STATE_CONFIG` keeps its identity across the saves that did not
 * touch it and nothing derived from it is rebuilt for them.
 */
export function applyStages(config: StageConfig): void {
  if (config === current || sameStages(config, current)) return
  current = config
  STATE_CONFIG = config.stages
  STATE_IDS = config.ids
}

/** The open tracker's stages as a whole, for code that has to pass them on. */
export function currentStages(): StageConfig {
  return current
}

export function isStateId(value: unknown): value is StateId {
  return current.has(value)
}

/** Position of a stage in the configured order, for deterministic sorting. */
export function stateRank(state: StateId): number {
  return current.rank(state)
}

export function stateLabel(state: StateId): string {
  return current.label(state)
}

/** The stage after this one, or null at the last. A shortcut, never a restriction. */
export function nextState(state: StateId): StateId | null {
  return STATE_IDS[stateRank(state) + 1] ?? null
}

/** The stage before this one, or null at the first. */
export function previousState(state: StateId): StateId | null {
  const rank = stateRank(state)
  return rank > 0 ? STATE_IDS[rank - 1] ?? null : null
}

/**
 * How a stage is going. `active` is the one outcome that is still running; the other three
 * say who ended it, and each means something at every stage — at Accepted too, where
 * withdrawn is backing out of a job you took and closed is the offer rescinded. The order
 * is the order the filter and the editor list them in.
 */
export const OUTCOME_CONFIG = [
  { id: 'active', label: 'Active', description: 'Still running' },
  { id: 'rejected', label: 'Rejected', description: 'They turned you down' },
  { id: 'withdrawn', label: 'Withdrawn', description: 'You pulled out' },
  { id: 'closed', label: 'Closed', description: 'They stopped: role filled, pulled or frozen, or they went silent' },
] as const satisfies readonly { id: OutcomeId; label: string; description: string }[]

export const OUTCOME_IDS = Object.freeze(OUTCOME_CONFIG.map(({ id }) => id)) as readonly OutcomeId[]

const OUTCOME_LABELS = Object.fromEntries(
  OUTCOME_CONFIG.map(({ id, label }) => [id, label]),
) as Record<OutcomeId, string>

const outcomeSet = new Set<string>(OUTCOME_IDS)

export function isOutcomeId(value: unknown): value is OutcomeId {
  return typeof value === 'string' && outcomeSet.has(value)
}

export function outcomeLabel(outcome: OutcomeId): string {
  return OUTCOME_LABELS[outcome]
}

export function outcomeRank(outcome: OutcomeId): number {
  return OUTCOME_IDS.indexOf(outcome)
}

/** The ways an application ends — every outcome but `active` — which the End menu offers. */
export const ENDING_OUTCOMES = Object.freeze(
  OUTCOME_IDS.filter((outcome) => outcome !== 'active'),
) as readonly OutcomeId[]

/**
 * The words a stage and an outcome read as together. Two pairs keep the names they had as
 * states of their own, because those are the words people already use for them — nobody
 * says "Applied — Rejected" for an application that never reached a person.
 */
const STATUS_NAMES: Partial<Record<`${StateId}:${OutcomeId}`, string>> = {
  'applied:rejected': 'Auto-rejected',
  'headhunted:closed': 'No openings',
}

export function statusLabel({ state, outcome }: Status, stages: StageConfig = current): string {
  if (outcome === 'active') return stages.label(state)
  return STATUS_NAMES[`${state}:${outcome}`] ?? `${stages.label(state)} — ${outcomeLabel(outcome)}`
}

export function sameStatus(left: Status, right: Status): boolean {
  return left.state === right.state && left.outcome === right.outcome
}

/** The stage a search ends in when it succeeds. */
export const FINAL_STATE: StateId = 'accepted'

/**
 * Whether an application is still running, was turned down, or is finished some other way:
 * withdrawn, closed by the employer — or accepted, the job you took, which is finished for
 * the search even while it is active as an application. That last is what keeps an accepted
 * job out of the urgency ranking and off the Idle list, and what lets Archive all ended put
 * it away with the rest when the next search starts.
 *
 * A view-only grouping: it never restricts moves, and any status can still move to any other.
 */
export type Lifecycle = 'live' | 'rejected' | 'closed'

export function classifyLifecycle({ state, outcome }: Status): Lifecycle {
  if (outcome === 'rejected') return 'rejected'
  if (outcome !== 'active' || state === FINAL_STATE) return 'closed'
  return 'live'
}

/**
 * Whether moving into this outcome abandons a task left on the application. Turned down and
 * pulled out both end the work; one on a role the employer closed may be "check back in
 * March". A task on an accepted job is live work, and reaching Accepted is a stage move,
 * which never drops a task.
 */
export function outcomeAbandonsTask(outcome: OutcomeId): boolean {
  return outcome === 'rejected' || outcome === 'withdrawn'
}

/** What the stage filter can be set to: one stage, or all of them. */
export type StateFilter = StateId | 'all'

export function stateFilterMatches(filter: StateFilter, state: StateId): boolean {
  return filter === 'all' || state === filter
}

/** The stages a filter admits, or undefined for the filter that admits every one. */
export function statesForFilter(filter: StateFilter): readonly StateId[] | undefined {
  return filter === 'all' ? undefined : [filter]
}

/**
 * What the outcome filter can be set to: one outcome, `ended` for any of the four that are not
 * `active`, or all. Orthogonal to the stage filter, so "Round 1, rejected" is one pair of
 * choices rather than a state of its own.
 */
export type OutcomeFilter = OutcomeId | 'all' | 'ended'

export function outcomeFilterMatches(filter: OutcomeFilter, outcome: OutcomeId): boolean {
  if (filter === 'all') return true
  if (filter === 'ended') return outcome !== 'active'
  return outcome === filter
}

export function outcomesForFilter(filter: OutcomeFilter): readonly OutcomeId[] {
  return OUTCOME_IDS.filter((outcome) => outcomeFilterMatches(filter, outcome))
}

/**
 * Whether archived applications are in view. `current` is the default: the search you are
 * running now, with the last one's leftovers put away.
 */
export type ArchiveFilter = 'current' | 'archived' | 'all'

export function archiveFilterMatches(filter: ArchiveFilter, archivedAt: string | null): boolean {
  if (filter === 'all') return true
  return filter === 'archived' ? archivedAt !== null : archivedAt === null
}
