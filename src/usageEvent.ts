import { OUTCOME_CONFIG, STATE_CONFIG } from './domain/states'

/**
 * What the hosted build may report about how it is used, and the one check both ends run on
 * it: the app before it sends, the Worker before it stores.
 *
 * Every property is one of a short list of fixed words. Nothing a person typed can fit in
 * one — no company, no note, no name, no date, no count finer than a bucket — so a report
 * cannot carry what someone wrote even by mistake, and the Worker refuses anything that is
 * not on these lists rather than trusting the app to have sent only them.
 *
 * `tracker` is a hash of the tracker's id, not the id itself: the id is in the page's URL,
 * and the URL is the one place it could otherwise be matched against.
 */

export const USAGE_VERSION = 1

const BUCKET_APPLICATIONS = ['0', '1-2', '3-10', '11-50', '51+'] as const
const BUCKET_AGE = ['none', '0d', '1-7d', '8-30d', '31-90d', '91d+'] as const
const BUCKET_BACKLOG = ['none', '<1d', '1-7d', '8d+'] as const
const YES_NO = ['y', 'n'] as const

/** The features whose use the snapshot reports, each as y or n. */
export const USAGE_FEATURES = [
  'notes',
  'captures',
  'messages',
  'invites',
  'ratings',
  'compensation',
  'posting',
  'attachments',
  'done',
  'archived',
] as const
export type UsageFeature = (typeof USAGE_FEATURES)[number]

export const USAGE_PLACES = ['kanban', 'table', 'statistics', 'compare', 'prep'] as const
export type UsagePlace = (typeof USAGE_PLACES)[number]

/**
 * Each event and, in order, the properties it carries with the values each may take. The
 * order is the order they are stored in, so a query can name a column by position.
 */
export const USAGE_EVENTS = {
  /** Once per page load: the shape of the tracker, never its contents. */
  open: {
    applications: BUCKET_APPLICATIONS,
    /** How long ago the oldest application was added. */
    age: BUCKET_AGE,
    /** The furthest any application has got. */
    reached: ['none', 'interview', 'offer', 'accepted'],
    storage: ['folder', 'browser', 'unsupported'],
    backlog: BUCKET_BACKLOG,
    ...Object.fromEntries(USAGE_FEATURES.map((feature) => [feature, YES_NO])) as Record<
      UsageFeature,
      typeof YES_NO
    >,
  },
  application_added: {},
  moved: {
    stage: STATE_CONFIG.map((state) => state.id),
    outcome: OUTCOME_CONFIG.map((outcome) => outcome.id),
  },
  view: { place: USAGE_PLACES },
  folder_connected: {},
  exported: {},
  /** A file arrived to be imported; `ok` is whether it could be read. */
  imported: { ok: YES_NO },
  error: { kind: ['load', 'save'] },
} as const satisfies Record<string, Record<string, readonly string[]>>

export type UsageEventName = keyof typeof USAGE_EVENTS
export type UsageProps<E extends UsageEventName> = {
  [K in keyof (typeof USAGE_EVENTS)[E]]: (typeof USAGE_EVENTS)[E][K] extends readonly (infer V)[] ? V : never
}

export interface UsageReport {
  v: typeof USAGE_VERSION
  /** 16 hex characters: a hash of the tracker id. */
  tracker: string
  profile: 'live' | 'demo'
  event: UsageEventName
  props: Record<string, string>
}

const TRACKER_TAG = /^[0-9a-f]{16}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The report, if it is exactly one the app is allowed to send; null otherwise. Exactly:
 * a property missing, a property extra, or a value off its list is refused whole, so
 * nothing outside these lists is ever stored.
 */
export function parseUsageReport(value: unknown): UsageReport | null {
  if (!isRecord(value)) return null
  const { v, tracker, profile, event, props } = value
  if (v !== USAGE_VERSION) return null
  if (typeof tracker !== 'string' || !TRACKER_TAG.test(tracker)) return null
  if (profile !== 'live' && profile !== 'demo') return null
  if (typeof event !== 'string' || !Object.hasOwn(USAGE_EVENTS, event)) return null
  if (!isRecord(props)) return null
  const allowed: Record<string, readonly string[]> = USAGE_EVENTS[event as UsageEventName]
  const keys = Object.keys(allowed)
  if (Object.keys(props).length !== keys.length) return null
  for (const key of keys) {
    const given = props[key]
    if (typeof given !== 'string' || !allowed[key].includes(given)) return null
  }
  return { v, tracker, profile, event: event as UsageEventName, props: props as Record<string, string> }
}

/**
 * How a report is stored in Workers Analytics Engine: the tracker tag as the index, then
 * the event, the profile and the properties in their declared order as blob1, blob2, ….
 */
export function usageDataPoint(report: UsageReport): { indexes: string[]; blobs: string[]; doubles: number[] } {
  const order = Object.keys(USAGE_EVENTS[report.event])
  return {
    indexes: [report.tracker],
    blobs: [report.event, report.profile, ...order.map((key) => report.props[key])],
    doubles: [report.v],
  }
}
