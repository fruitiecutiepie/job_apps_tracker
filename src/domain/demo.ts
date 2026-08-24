import { COMPENSATION_STAGE_IDS, emptyCompensation } from './compensation'
import { prepareTrackerDatabase } from './database'
import { RATING_IDS } from './ratings'
import { STATE_IDS } from './states'
import type {
  Application,
  Compensation,
  CompensationStageId,
  Rating,
  RatingDimensionId,
  StageNote,
  StateEvent,
  StateHistoryEntry,
  StateId,
  TrackerDocument,
} from './types'

interface DemoSeed {
  company: string
  role: string | null
  state: StateId
  createdDaysAgo: number
  updatedDaysAgo: number
  priorStates?: StateId[]
  nextAction?: string
  nextActionDaysFromNow?: number
  deadlineDaysFromNow?: number
  /** Edits updated_at without moving state, so silence and last-touched diverge. */
  editedDaysAgo?: number
  notes?: string
  source?: string | null
  /** Omit a dimension for never-assessed; give it null for an explicit "don't know". */
  ratings?: Partial<Record<RatingDimensionId, number | null>>
  compensation?: DemoCompensationSeed
  stageNotes?: Partial<Record<StateId, string>>
  /** Lines captured during a stage, in the order they were said. */
  stageHeard?: Partial<Record<StateId, readonly string[]>>
  stateEvents?: readonly DemoEventSeed[]
}

/**
 * Whole annual amounts in `currency`. A single number is a point value; a pair is the band a
 * posting quotes. Omit a stage for "not recorded".
 */
interface DemoCompensationSeed {
  currency: string
  advertised?: number | readonly [number, number]
  expected?: number | readonly [number, number]
  offered?: number | readonly [number, number]
}

interface DemoEventSeed {
  state: StateId
  summary: string
  daysFromNow: number
  hour: number
  minutes: number
  location?: string
  url?: string
  cancelled?: boolean
}

const DEMO_SEEDS: readonly DemoSeed[] = [
  { company: 'Northstar Labs', role: 'Staff Product Designer', state: 'headhunted', createdDaysAgo: 22, updatedDaysAgo: 22, compensation: { currency: 'AUD', expected: 190_000 }, editedDaysAgo: 1, notes: 'Introduced through a former teammate. Tidied these notes yesterday, but the conversation itself has not moved since the first message.', source: 'Referral' },
  { company: 'Juniper Works', role: 'Frontend Engineer', state: 'no_openings', createdDaysAgo: 47, updatedDaysAgo: 31, priorStates: ['headhunted'], nextAction: 'Check the careers page next quarter', notes: 'Hiring is paused, but the team asked to stay in touch.', source: 'Company site' },
  { company: 'Marble & Finch', role: 'Product Manager', state: 'applied', createdDaysAgo: 9, updatedDaysAgo: 9, compensation: { currency: 'AUD', advertised: [110_000, 125_000] }, nextAction: 'Follow up on the application', nextActionDaysFromNow: -2, deadlineDaysFromNow: -1, notes: 'Applied with a tailored portfolio.', source: 'LinkedIn' },
  { company: 'Copperline Health', role: 'Data Analyst', state: 'auto_rejected', createdDaysAgo: 39, updatedDaysAgo: 38, priorStates: ['applied'], notes: 'Automated rejection arrived the following morning.', source: 'Job board' },
  { company: 'Paper Kite', role: 'Senior UX Researcher', state: 'recruiter_messaged', createdDaysAgo: 7, updatedDaysAgo: 3, compensation: { currency: 'AUD', advertised: [100_000, 115_000], expected: 130_000 }, priorStates: ['applied'], nextAction: 'Send availability to the recruiter', nextActionDaysFromNow: -1, notes: 'Recruiter asked for three interview windows.', source: 'Recruiter' },
  { company: 'Tidal Grove', role: 'Platform Engineer', state: 'recruiter_messaged_rejected', createdDaysAgo: 26, updatedDaysAgo: 17, priorStates: ['applied', 'recruiter_messaged'], notes: 'Role requires a different on-call timezone.', source: 'LinkedIn' },
  { company: 'Orbit & Oak', role: 'Operations Lead', state: 'online_assessment', createdDaysAgo: 12, updatedDaysAgo: 2, compensation: { currency: 'AUD', advertised: [120_000, 140_000], expected: 135_000 }, priorStates: ['applied', 'recruiter_messaged'], nextAction: 'Complete the scenario assessment', nextActionDaysFromNow: 3, deadlineDaysFromNow: 4, notes: 'Assessment should take about 75 minutes.', source: 'Company site' },
  { company: 'Bright Harbor', role: 'Software Engineer', state: 'online_assessment_rejected', createdDaysAgo: 44, updatedDaysAgo: 29, priorStates: ['applied', 'online_assessment'], notes: 'Passed most cases; concurrency section was incomplete.' },
  { company: 'Atlas Thread', role: 'Design Systems Lead', state: 'recruiter_interview', createdDaysAgo: 18, updatedDaysAgo: 2, compensation: { currency: 'AUD', advertised: [160_000, 185_000], expected: 175_000 }, ratings: { work: 4, growth: 4, people: null }, priorStates: ['applied', 'recruiter_messaged'], nextAction: 'Prepare examples of system governance', nextActionDaysFromNow: 1, notes: 'Thirty-minute video call with the internal recruiter.', source: 'Recruiter', stateEvents: [{ state: 'recruiter_interview', summary: 'Recruiter interview with Dana', daysFromNow: 1, hour: 11, minutes: 30, location: 'Level 4, 220 Example Street', url: 'https://example.com/meet/atlas-thread' }], stageNotes: { recruiter_messaged: '- Recruiter is **Dana**\n- Asked for salary expectations early — answer with the band, not a number', recruiter_interview: '## Story to lead with\n\n- Consolidating four component libraries into one system\n  - Cut component duplication by half\n  - Adopted by six product teams in a quarter\n\n## Questions to ask\n\n- How is design system work resourced between product teams?\n- What does the loop after this look like?' } },
  { company: 'Cinder Studio', role: 'Product Designer', state: 'recruiter_interview_rejected', createdDaysAgo: 35, updatedDaysAgo: 20, priorStates: ['applied', 'recruiter_messaged', 'recruiter_interview'], notes: 'Team selected someone with deeper enterprise experience.', source: 'LinkedIn' },
  { company: 'Kindred Cloud', role: 'Developer Advocate', state: 'take_home_assessment', createdDaysAgo: 16, updatedDaysAgo: 1, compensation: { currency: 'USD', advertised: [90_000, 110_000], expected: 105_000 }, priorStates: ['applied', 'recruiter_interview'], nextAction: 'Submit the API tutorial', nextActionDaysFromNow: 9, deadlineDaysFromNow: 12, notes: 'Keep the written exercise under 1,500 words. The window is generous, so this is not pressing yet.', source: 'Company site', stageNotes: { take_home_assessment: '## Brief\n\nWrite an API tutorial under **1,500 words**.\n\n## Outline\n\n1. Problem\n2. Quickstart\n3. One worked example\n4. Troubleshooting\n\nReuse the webhook walkthrough structure that tested well before.' } },
  { company: 'Willow Finance', role: 'Risk Product Manager', state: 'take_home_assessment_rejected', createdDaysAgo: 51, updatedDaysAgo: 24, priorStates: ['applied', 'recruiter_interview', 'take_home_assessment'], notes: 'Good feedback on structure; domain depth was the deciding factor.', source: 'Job board' },
  { company: 'Echo Robotics', role: 'Human Factors Researcher', state: 'interview_1', createdDaysAgo: 21, updatedDaysAgo: 4, priorStates: ['applied', 'recruiter_interview'], notes: 'The panel went ahead four days ago. Waiting on feedback with nothing booked in.', source: 'Referral', stageNotes: { interview_1: '## Panel\n\n- Design\n- Engineering\n- Research\n\n## Case study\n\n- The teleoperation study\n  - 12 participants across two rounds\n  - Shipped three safety changes\n  - Task completion rose from **61% to 88%**\n\n## Questions to ask\n\n- Ask each panellist what they would want researched first' } },
  { company: 'Mosslight Energy', role: 'Senior Data Scientist', state: 'interview_1_rejected', createdDaysAgo: 62, updatedDaysAgo: 34, priorStates: ['applied', 'online_assessment', 'recruiter_interview', 'interview_1'], notes: 'Technical discussion went well; another candidate had energy-market experience.', source: 'LinkedIn' },
  { company: 'Halcyon Maps', role: 'Engineering Manager', state: 'interview_2', createdDaysAgo: 25, updatedDaysAgo: 1, compensation: { currency: 'AUD', advertised: [180_000, 210_000], expected: 200_000, offered: 215_000 }, ratings: { work: 5, growth: 4, people: 4, company: 4 }, priorStates: ['applied', 'recruiter_interview', 'interview_1'], nextAction: 'Join the leadership interview', nextActionDaysFromNow: 0, notes: 'Final conversation with the VP of Engineering.', source: 'Recruiter', stateEvents: [{ state: 'interview_1', summary: 'Interview 1 — hiring manager', daysFromNow: -6, hour: 10, minutes: 60, cancelled: true }, { state: 'interview_2', summary: 'Leadership interview with the VP of Engineering', daysFromNow: 0, hour: 15, minutes: 45, url: 'https://example.com/meet/halcyon-maps' }], stageNotes: { interview_1: 'Went well. They pushed hard on incident response — reuse the on-call rotation rebuild story.', interview_2: 'Final conversation with the VP of Engineering.\n\n## Leadership themes\n\n- Growing seniors into leads\n  - The two promotions I sponsored last year\n- Cutting cycle time\n  - Trunk-based release change, two weeks to two days\n- Where I hold the hiring bar\n\n## Questions to ask\n\n- How is platform work prioritised against roadmap commitments?\n- What does the first 90 days look like?', offer: 'Before answering, confirm:\n\n- The level\n  - They hinted at Staff, the ad said Senior\n- The equity refresh policy\n- Remote expectations\n\n> From the ad: "occasional travel to the London office" — pin down what occasional means.' }, stageHeard: { interview_2: ['Team is 40 engineers across four squads', 'Platform work gets a fixed 20% of each quarter', 'Decision comes back by the end of next week'] } },
  { company: 'Fern & Field', role: 'Brand Director', state: 'interview_2_rejected', createdDaysAgo: 73, updatedDaysAgo: 41, priorStates: ['headhunted', 'recruiter_interview', 'interview_1', 'interview_2'], nextAction: 'Thank the hiring manager and stay connected', notes: 'A thoughtful process and useful portfolio feedback.', source: 'Referral' },
  { company: 'Lumen Pantry', role: 'Head of Growth', state: 'offer', createdDaysAgo: 33, updatedDaysAgo: 1, compensation: { currency: 'AUD', advertised: [230_000, 260_000], expected: 250_000, offered: 230_000 }, ratings: { work: 5, growth: 5, people: 1, company: 5 }, priorStates: ['applied', 'recruiter_interview', 'interview_1', 'interview_2'], nextAction: 'Review compensation and equity terms', notes: 'Written offer received. No decision date given yet, so the review is not booked in.', source: 'Company site', stageNotes: { offer: '## Where the offer stands\n\n- Base is **8% below** target\n- Equity is above target\n- Ask for the base to move first\n\n## Confirm before accepting\n\n- Review cycle\n- Start date flexibility\n- Learning budget' } },
  { company: 'Redwood Relay', role: 'Principal Engineer', state: 'offer_rejected', createdDaysAgo: 88, updatedDaysAgo: 46, priorStates: ['headhunted', 'recruiter_interview', 'interview_1', 'interview_2', 'offer'], notes: 'Declined after the location policy changed.', source: 'Recruiter' },
  { company: 'Saffron Systems', role: 'Product Operations Manager', state: 'accepted', createdDaysAgo: 58, updatedDaysAgo: 6, priorStates: ['applied', 'recruiter_messaged', 'recruiter_interview', 'interview_1', 'interview_2', 'offer'], nextAction: 'Prepare questions for onboarding', notes: 'Start date confirmed. Background check complete.', source: 'LinkedIn' },
]

function localDay(reference: Date, daysFromReference: number, hour = 10): Date {
  const date = new Date(reference)
  date.setHours(hour, 0, 0, 0)
  date.setDate(date.getDate() + daysFromReference)
  return date
}

function historyFor(seed: DemoSeed, reference: Date): StateHistoryEntry[] {
  const states = [...(seed.priorStates ?? []), seed.state]
  const created = localDay(reference, -seed.createdDaysAgo, 9).getTime()
  const updated = localDay(reference, -seed.updatedDaysAgo, 16).getTime()
  return states.map((state, index) => {
    const fraction = states.length === 1 ? 0 : index / (states.length - 1)
    const at = new Date(created + (updated - created) * fraction).toISOString()
    return { state, at }
  })
}

/** Timestamps come from the reference date, never the wall clock, to stay deterministic. */
function ratingsFor(seed: DemoSeed, updatedAt: string): Rating[] {
  return RATING_IDS.flatMap((dimension) => {
    if (!seed.ratings || !(dimension in seed.ratings)) return []
    const score = seed.ratings[dimension] ?? null
    return [{ dimension, score, created_at: updatedAt, updated_at: updatedAt }]
  })
}

/**
 * Compensation carries no per-record timestamps, so unlike ratings and prep notes there is
 * nothing here to derive from the reference date — which is one less way the determinism test
 * can break.
 */
function compensationFor(seed: DemoSeed): Compensation {
  const record = emptyCompensation()
  if (!seed.compensation) return record

  for (const stage of COMPENSATION_STAGE_IDS) {
    const amount = seed.compensation[stage as CompensationStageId]
    if (amount === undefined) continue
    record[stage] =
      typeof amount === 'number'
        ? { min: amount, max: amount }
        : { min: amount[0], max: amount[1] }
  }
  record.currency = seed.compensation.currency
  return record
}

function stageNotesFor(
  seed: DemoSeed,
  index: number,
  history: StateHistoryEntry[],
  updatedAt: string,
): StageNote[] {
  const reachedAt = new Map(history.map((entry) => [entry.state, entry.at]))
  return STATE_IDS.flatMap((state) => {
    const body = seed.stageNotes?.[state]
    const said = seed.stageHeard?.[state] ?? []
    if (!body && said.length === 0) return []
    const at = reachedAt.get(state) ?? updatedAt
    // Captured a minute apart, so the examples read in the order they were said.
    const heard = said.map((line, order) => ({
      id: demoHeardId(index, STATE_IDS.indexOf(state), order),
      body: line,
      at: new Date(Date.parse(at) + order * 60_000).toISOString(),
    }))
    return [{ state, body: body ?? '', heard, created_at: at, updated_at: at }]
  })
}

function demoStateEvents(seed: DemoSeed, index: number, reference: Date, updatedAt: string): StateEvent[] {
  return (seed.stateEvents ?? []).map((event, order) => {
    const start = localDay(reference, event.daysFromNow, event.hour)
    return {
      id: demoEventId(index, order),
      state: event.state,
      summary: event.summary,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + event.minutes * 60_000).toISOString(),
      location: event.location ?? null,
      url: event.url ?? null,
      ics_uid: `demo-${index + 1}-${order + 1}@example.com`,
      sequence: 0,
      cancelled: event.cancelled ?? false,
      created_at: updatedAt,
      updated_at: updatedAt,
    }
  })
}

function demoId(index: number): string {
  return `018f0000-0000-7000-8000-${String(index + 1).padStart(12, '0')}`
}

function demoHeardId(index: number, state: number, order: number): string {
  return `018f0000-0000-7000-a000-${String(index + 1).padStart(6, '0')}${String(state + 1).padStart(3, '0')}${String(order + 1).padStart(3, '0')}`
}

function demoEventId(index: number, order: number): string {
  return `018f0000-0000-7000-9000-${String(index + 1).padStart(9, '0')}${String(order + 1).padStart(3, '0')}`
}

/**
 * The instant every demo timestamp is measured from. Exported so tests can pin the wall clock
 * to it: the seeds are deterministic, but a view's notion of "today" is not, and the two drift
 * apart until stale, overdue and calendar expectations quietly change meaning.
 */
export const DEFAULT_DEMO_REFERENCE = '2026-08-14T02:00:00.000Z'

export function createDemoDocument(
  reference: Date = new Date(DEFAULT_DEMO_REFERENCE),
): TrackerDocument {
  const applications: Application[] = DEMO_SEEDS.map((seed, index) => {
    const history = historyFor(seed, reference)
    const createdAt = history[0].at
    const lastMoveAt = history[history.length - 1].at
    // An edit refreshes updated_at without moving state, which is why Focus measures
    // silence from state_history instead.
    const updatedAt =
      seed.editedDaysAgo !== undefined
        ? localDay(reference, -seed.editedDaysAgo, 16).toISOString()
        : lastMoveAt
    return {
      id: demoId(index),
      company: seed.company,
      role: seed.role,
      url: `https://example.com/jobs/${index + 1}`,
      source: seed.source ?? null,
      state: seed.state,
      state_history: history,
      next_action: seed.nextAction ?? null,
      next_action_at:
        seed.nextAction !== undefined && seed.nextActionDaysFromNow !== undefined
          ? localDay(reference, seed.nextActionDaysFromNow, 9).toISOString()
          : null,
      deadline_at:
        seed.deadlineDaysFromNow !== undefined
          ? localDay(reference, seed.deadlineDaysFromNow, 17).toISOString()
          : null,
      notes: seed.notes ?? null,
      stage_notes: stageNotesFor(seed, index, history, updatedAt),
      state_events: demoStateEvents(seed, index, reference, updatedAt),
      attachments: [],
      ratings: ratingsFor(seed, updatedAt),
      compensation: compensationFor(seed),
      created_at: createdAt,
      updated_at: updatedAt,
    }
  })

  const coveredStates = new Set(applications.map((application) => application.state))
  if (
    applications.length !== STATE_IDS.length
    || coveredStates.size !== STATE_IDS.length
    || STATE_IDS.some((state) => !coveredStates.has(state))
  ) {
    throw new Error('Demo data must contain exactly one application per state')
  }
  return prepareTrackerDatabase(applications)
}
